import { Request, Response } from "express";
import { Types } from "mongoose";
import { OrganizationModel } from "../models";

export async function getOrganizationDetail(req: Request, res: Response) {
  try {
    const { organizationId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    const organization = await OrganizationModel.findById(organizationId)
      .select("name logo_url")
      .lean();
    if (!organization) {
      return res.status(404).json({ message: "Organization not found" });
    }

    return res.status(200).json({ organization });
  } catch (error) {
    console.error("Error in getOrganizationDetail:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

