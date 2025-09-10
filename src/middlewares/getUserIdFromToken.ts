import jwt from "jsonwebtoken";
import { UserModel } from "../models";

async function getUserIdFromToken(req, res, next) {
  const token = req.cookies.accessToken;

  try {
    //decoded will has only sub
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if this userId in User
    const user = await UserModel.findOne({ _id: decoded.sub });

    if (!user) {
      req.user = null;
      return next();
    }

    req.user = {
      id: user._id,
    };

    next();
  } catch (err) {
    req.user = null;
    next();
  }
}

export default getUserIdFromToken;
