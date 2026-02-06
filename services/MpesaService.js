// controllers/mpesaController.js
import axios from 'axios';
import crypto from 'crypto';
import { Payment } from '../models/Subscription/Subcription.js';
import { Subscription } from '../models/Subscription/Subcription.js';
// Generate M-Pesa access token
const generateAccessToken = async () => {
  try {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 5000 // Add timeout
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Access token error:', error.response?.data || error.message);
    throw new Error('Failed to get access token');
  }
};

// Initiate STK Push
export const initiateSTKPush = async (req, res) => {
  try {
    const { phone, amount, subscriptionId } = req.body;
    
    // Create payment record
    const payment = new Payment({
      subscription: subscriptionId,
      amount,
      status: 'pending',
      paymentMethod: 'mpesa'
    });
    await payment.save();

    // SANDBOX CREDENTIALS
    const shortcode = 174379;
    const passkey = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

    const accessToken = await generateAccessToken();
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // Format phone number
    const formattedPhone = `254${phone.replace(/\D/g, '').slice(-9)}`;

    // Dynamic URLs
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? process.env.API_BASE_URL 
      : req.app.locals.ngrokUrl;
    
    const callbackUrl = `${baseUrl}/api/mpesa/callback`;
    const timeoutUrl = `${baseUrl}/api/mpesa/timeout`;

    console.log('Callback URL:', callbackUrl);
    console.log('Timeout URL:', timeoutUrl);

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      QueueTimeOutURL: timeoutUrl, // Essential for queue timeouts
      AccountReference: `SUB-${subscriptionId.slice(-6)}`,
      TransactionDesc: 'Subscription Payment'
    };
    console.log(stkPayload)
    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      stkPayload,
      { 
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // Update payment with checkout ID
    payment.transactionId = response.data.CheckoutRequestID;
    await payment.save();

    res.status(200).json({
      success: true,
      message: 'STK push initiated',
      checkoutRequestId: response.data.CheckoutRequestID,
      paymentId: payment._id
    });
  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.errorMessage || 'Payment initiation failed',
      error: error.message
    });
  }
};
export const handleMPESACallback = async (req, res) => {
  try {
    console.log('MPesa Callback Received:', new Date());
    console.log('Raw Body:', req.body);

    // Correctly parse the callback structure
    const callbackData = req.body;
    const stkCallback = callbackData.Body?.stkCallback;
    
    if (!stkCallback) {
      return res.status(400).json({ error: 'Invalid callback format' });
    }

    // Extract values from the nested structure
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    // Find payment using correct field name
    const payment = await Payment.findOne({ transactionId: checkoutRequestId });
    
    if (!payment) {
      console.error(`Payment not found for CheckoutRequestID: ${checkoutRequestId}`);
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Process payment status
    if (resultCode > 0) {
      payment.status = 'success';
      payment.paidAt = new Date();
      
      // Extract M-Pesa receipt safely
      const metadata = stkCallback.CallbackMetadata;
      if (metadata?.Item) {
        const receiptItem = metadata.Item.find(item => item.Name === 'MpesaReceiptNumber');
        if (receiptItem) payment.mpesaReceipt = receiptItem.Value;
      }
    } else {
      payment.status = 'failed';
      payment.failureReason = resultDesc;
    }

    payment.paymentGatewayResponse = callbackData;
    await payment.save();

    // Update subscription only for successful payments
    if (payment.status === 'success') {
      const subscription = await Subscription.findById(payment.subscription);
      if (subscription) {
        subscription.status = 'active';
        subscription.latestPayment = payment._id;
        subscription.startDate = new Date();
        
        // Calculate next billing date
        let billingPeriod = 30; // Default monthly
        if (subscription.billingCycle === 'quarterly') billingPeriod = 90;
        if (subscription.billingCycle === 'annual') billingPeriod = 365;
        
        subscription.nextBillingDate = new Date(
          subscription.startDate.getTime() + billingPeriod * 24 * 60 * 60 * 1000
        );
        
        await subscription.save();
      }
    }

    res.status(200).json({ status: 'Callback processed' });
  } catch (error) {
    console.error('Callback processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// Handle queue timeout
export const handleQueueTimeout = async (req, res) => {
  try {
    const signature = req.headers['x-callback-signature'];
    const rawBody = req.body.toString('utf8');
    
    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.MPESA_PASSKEY)
      .update(rawBody)
      .digest('base64');
    
    if (signature !== generatedSignature) {
      console.error('Timeout signature mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const timeoutData = JSON.parse(rawBody);
    const checkoutRequestId = timeoutData.CheckoutRequestID;

    const payment = await Payment.findOne({ transactionId: checkoutRequestId });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    payment.status = 'failed';
    payment.failureReason = 'Queue timeout at M-Pesa';
    payment.paymentGatewayResponse = timeoutData;
    await payment.save();

    res.status(200).json({ status: 'Timeout processed' });
  } catch (error) {
    console.error('Timeout processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Validate M-Pesa IPs (for testing)
export const validateMPesaIPs = () => {
  const safaricomIPs = [
    '196.201.214.200', '196.201.214.206', '196.201.213.114',
    '196.201.214.207', '196.201.214.208', '196.201.213.44',
    '196.201.212.127', '196.201.212.138', '196.201.212.129',
    '196.201.212.136', '196.201.212.74', '196.201.212.69'
  ];
  
  return safaricomIPs;
};