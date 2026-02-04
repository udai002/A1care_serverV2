import RedisClient from "../../configs/redisConnect.js";
import { ApiError } from "../../utils/ApiError.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import generateOtp from "../../utils/generateOtp.js";
import doctorModel from "./doctor.model.js";
import doctorValidation from "./doctor.schema.js";
import jwt from 'jsonwebtoken'
import { v1 as uuidv4 } from "uuid";
import { hmacHash } from "../../utils/Hmac.js";

//create doctor 
export const createDoctor = asyncHandler(async (req , res)=>{
    const payload = {
        ...req.body, 
        
    } 

    const parsed = doctorValidation.safeParse(payload)
    if(!parsed.success){
        console.error("Error in creating doctor" , parsed.error)
        throw new ApiError(401 , "Validation Falied!" )
    }

    const newDoctor = new doctorModel(payload)
    await newDoctor.save() 
    return res.status(201).json(new ApiResponse(201 , "Hurray..! Doctor created." , newDoctor))
})

//get doctor by id 
export const getDoctorById = asyncHandler(async (req , res)=>{
    const {doctorId} = req.params
    const gotDoctor = await doctorModel.findById(doctorId)
    return res.status(200).json(new ApiResponse(200 , "doctor found.." , gotDoctor))
})

//get the staff by role id
export const getStaffByRoleId = asyncHandler(async (req , res)=>{
    const {roleId} = req.query
    if(!roleId){
        throw new ApiError(404 , "Role id is missing")
    }
    const roleIds = (roleId as string).split(',').map(id => id.trim());
    console.log("role id is here.." ,)
    if(!roleId) throw new ApiError(404 , "Role id is missing")
    const staffDetails= await doctorModel.find({roleId:{$in:roleIds}}).populate('roleId')
    return res.json(new ApiResponse(200 , "staff fetched successfully" , staffDetails))
})

// send otp for staff 
export const sendOtpForStaff = asyncHandler(async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    throw new ApiError(400, "Mobile number is required");
  }

  const normalizedMobile = mobileNumber.trim();
  const otp = generateOtp();
  const otpHash = hmacHash(otp.toString());
  const mobileHash = hmacHash(normalizedMobile);

  const otpSessionId = uuidv4();
  await RedisClient.setEx(
    `otp:${otpSessionId}`,
    300,
    JSON.stringify({
      otpHash,
      mobileHash,
      attempts: 0,
      expiresAt: Date.now() + 300_000
    })
  );


  return res.status(200).json(
    new ApiResponse(
      200,
      "OTP sent to your mobile number",
      { otpSessionId , otp }
    )
  );
});


//verify otp for staff 
export const verifyOtp = asyncHandler(async (req, res) => {
  const { otpSessionId, otp, mobileNumber } = req.body;

  if (!otpSessionId || !otp || !mobileNumber) {
    throw new ApiError(400, "otpSessionId, mobile number and OTP are required");
  }

  const redisData = await RedisClient.get(`otp:${otpSessionId}`);
  if (!redisData) {
    throw new ApiError(401, "OTP expired or invalid session");
  }

  const { otpHash, mobileHash, attempts } = JSON.parse(redisData);

  if (attempts >= 5) {
    await RedisClient.del(`otp:${otpSessionId}`);
    throw new ApiError(429, "Too many invalid attempts");
  }

  const normalizedMobile = mobileNumber.trim();
  const inputOtpHash = hmacHash(otp.toString());
  const inputMobileHash = hmacHash(normalizedMobile);

  if (inputMobileHash !== mobileHash) {
    throw new ApiError(401, "Mobile number mismatch");
  }

  if (inputOtpHash !== otpHash) {
    await RedisClient.setEx(
      `otp:${otpSessionId}`,
      300,
      JSON.stringify({
        otpHash,
        mobileHash,
        attempts: attempts + 1
      })
    );
    throw new ApiError(401, "Invalid OTP");
  }

  await RedisClient.del(`otp:${otpSessionId}`);

  let staff = await doctorModel.findOne({ mobileNumber: normalizedMobile });
  if (!staff) {
    staff = await doctorModel.create({ mobileNumber: normalizedMobile });
  }

  const token = jwt.sign(
    { staffId: staff._id },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  return res.status(200).json(
    new ApiResponse(200, "OTP verified successfully", { token })
  );
});


// get staff details
export const getStaffDetials = asyncHandler(async (req , res)=>{
    const staffId = req.user?.id
    console.log("staff id from middleware" , staffId)
    if(!staffId) throw new ApiError(401 , "Not authorzed to access");
    const staffDetails = await doctorModel.findById(staffId)
    console.log(staffDetails)
    return res.status(200).json(new ApiResponse(200 , "Staff details"  , staffDetails ))
})

// otp status check 
export const checkOtpStatus = asyncHandler(async (req ,res)=>{
    const {otpSessionId} = req.body
  console.log("this is the session id", otpSessionId)
    if(!otpSessionId) throw new ApiError(401 , "No session found");

    const otpSession = await RedisClient.get(`otp:${otpSessionId}`)
    if(!otpSession) throw new ApiError(404 , "Session exprired or invalid");

    const otpData = JSON.parse(otpSession)

    return res.status(200).json(new ApiResponse(200 , "OTP session available" , {otpSession}))
})

// register controller 
export const registerStaff = asyncHandler(async (req , res)=>{
  const parsed = doctorValidation.safeParse(req.body)
  const staffId = req.user?.id

  const findStaff = await doctorModel.findById(staffId)
  if(!findStaff) throw new ApiError(404 , "Staff not found" );

  const updateStaffId = await doctorModel.findByIdAndUpdate(staffId , {
    $set:{
      name:parsed.data?.name , 
      gender:parsed.data?.gender , 
      startExperience:parsed.data?.startExperience , 
      specialization:parsed.data?.specialization , 
      about:parsed.data?.about , 
      workingHours:parsed.data?.workingHours , 
      roleId:parsed.data?.roleId , 
      consultationFee:parsed.data?.consultationFee , 
      isRegistered:true
    }
  })

  return res.status(200).json(new ApiResponse(200 , "Registration successfull" , updateStaffId))
})