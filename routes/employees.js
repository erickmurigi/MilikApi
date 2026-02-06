import express from "express"
import { allEmployees, deleteEmployee , allEmloyeesMonthly,genderCount, getEmployee, getEmployees, updateEmployee, getAllEmployees, deleteLeave } from "../controllers/employee.js"
const router = express.Router()
import { verifyUser } from "../controllers/verifyToken.js"

//updating employee
router.put("/:id",verifyUser ,updateEmployee)

//deleting employee
router.delete("/:id",verifyUser ,deleteEmployee)

//get employee
router.get("/:id",verifyUser ,getEmployee)

//get all employees
router.get("/",getEmployees)

//get all employees
router.get("/all" ,getAllEmployees)

//count employees by gender
router.get('/count/gender',verifyUser ,genderCount)

//counting all employees
router.get("/count/all",verifyUser ,allEmployees)

//counting all employees
router.get("/count/monthly",verifyUser ,allEmloyeesMonthly)


router.delete("/:employeeId/leaves/:leaveId", verifyUser ,deleteLeave)


export default router