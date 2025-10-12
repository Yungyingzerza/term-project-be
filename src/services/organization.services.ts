import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  OrganizationModel,
  OrganizationMembershipModel,
  OrganizationInviteModel,
} from "../models";
import crypto from "crypto";

export async function getOrganizationDetail(req: Request, res: Response) {
  try {
    const { organizationId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    const organization = await OrganizationModel.findById(organizationId)
      .select("name logo_url description is_work_org")
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

// Create a new group (organization without domain requirements)
export async function createGroup(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { name, description, logo_url } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "Group name is required" });
    }

    // Create the group
    const organization = await OrganizationModel.create({
      name: name.trim(),
      description: description || "",
      logo_url: logo_url || undefined,
      is_work_org: false,
      domains: undefined,
    });

    // Add creator as admin
    await OrganizationMembershipModel.create({
      org_id: organization._id,
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    return res.status(201).json({
      message: "Group created successfully",
      organization: {
        _id: organization._id,
        name: organization.name,
        description: organization.description,
        logo_url: organization.logo_url,
      },
    });
  } catch (error) {
    console.error("Error in createGroup:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Create an invite code for a group
export async function createInviteCode(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId } = req.params;
    const { expiresInDays = 7, maxUses = null } = req.body;

    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    // Check if user is admin of the organization
    const membership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: "Only admins can create invite codes" });
    }

    // Generate unique invite code with collision handling
    let inviteCode: string;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      inviteCode = crypto.randomBytes(8).toString("hex");

      // Check if this code already exists
      const existing = await OrganizationInviteModel.findOne({
        invite_code: inviteCode,
      });
      if (!existing) {
        break; // Code is unique, we can use it
      }

      attempts++;
      if (attempts >= maxAttempts) {
        console.error(
          "Failed to generate unique invite code after",
          maxAttempts,
          "attempts"
        );
        return res.status(500).json({
          message: "Failed to generate invite code. Please try again.",
        });
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(expiresInDays));

    const invite = await OrganizationInviteModel.create({
      org_id: new Types.ObjectId(organizationId),
      invite_code: inviteCode!,
      created_by: new Types.ObjectId(userId),
      expires_at: expiresAt,
      max_uses: maxUses ? Number(maxUses) : null,
      current_uses: 0,
      is_active: true,
    });

    return res.status(201).json({
      message: "Invite code created successfully",
      invite: {
        invite_code: invite.invite_code,
        expires_at: invite.expires_at,
        max_uses: invite.max_uses,
        current_uses: invite.current_uses,
      },
    });
  } catch (error) {
    console.error("Error in createInviteCode:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get all invite codes for an organization
export async function getInviteCodes(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    // Check if user is admin of the organization
    const membership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: "Only admins can view invite codes" });
    }

    const invites = await OrganizationInviteModel.find({
      org_id: new Types.ObjectId(organizationId),
    })
      .select(
        "invite_code expires_at max_uses current_uses is_active created_at"
      )
      .sort({ created_at: -1 })
      .lean();

    return res.status(200).json({ invites });
  } catch (error) {
    console.error("Error in getInviteCodes:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Revoke an invite code
export async function revokeInviteCode(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { inviteCode } = req.params;
    if (!inviteCode) {
      return res.status(400).json({ message: "Invite code is required" });
    }

    const invite = await OrganizationInviteModel.findOne({
      invite_code: inviteCode,
    });
    if (!invite) {
      return res.status(404).json({ message: "Invite code not found" });
    }

    // Check if user is admin of the organization
    const membership = await OrganizationMembershipModel.findOne({
      org_id: invite.org_id,
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: "Only admins can revoke invite codes" });
    }

    await OrganizationInviteModel.findByIdAndUpdate(invite._id, {
      is_active: false,
    });

    return res
      .status(200)
      .json({ message: "Invite code revoked successfully" });
  } catch (error) {
    console.error("Error in revokeInviteCode:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Join a group using an invite code
export async function joinGroupWithInvite(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { inviteCode } = req.params;
    if (!inviteCode) {
      return res.status(400).json({ message: "Invite code is required" });
    }

    const invite = await OrganizationInviteModel.findOne({
      invite_code: inviteCode,
    });
    if (!invite) {
      return res.status(404).json({ message: "Invalid invite code" });
    }

    // Check if invite is still valid
    if (!invite.is_active) {
      return res
        .status(400)
        .json({ message: "This invite code has been revoked" });
    }

    if (new Date() > invite.expires_at) {
      return res.status(400).json({ message: "This invite code has expired" });
    }

    if (invite.max_uses !== null && invite.current_uses >= invite.max_uses) {
      return res
        .status(400)
        .json({ message: "This invite code has reached its maximum uses" });
    }

    // Check if user is already a member
    const existingMembership = await OrganizationMembershipModel.findOne({
      org_id: invite.org_id,
      user_id: new Types.ObjectId(userId),
    });

    if (existingMembership) {
      return res
        .status(400)
        .json({ message: "You are already a member of this group" });
    }

    // Add user to the organization
    await OrganizationMembershipModel.create({
      org_id: invite.org_id,
      user_id: new Types.ObjectId(userId),
      role: "member",
    });

    // Increment invite usage count
    await OrganizationInviteModel.findByIdAndUpdate(invite._id, {
      $inc: { current_uses: 1 },
    });

    const organization = await OrganizationModel.findById(invite.org_id).select(
      "name logo_url description"
    );

    return res.status(200).json({
      message: "Successfully joined the group",
      organization,
    });
  } catch (error) {
    console.error("Error in joinGroupWithInvite:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Get members of a group
export async function getGroupMembers(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    // Check if user is a member of the organization
    const userMembership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
    });

    if (!userMembership) {
      return res
        .status(403)
        .json({ message: "You must be a member to view group members" });
    }

    const memberships = await OrganizationMembershipModel.find({
      org_id: new Types.ObjectId(organizationId),
    })
      .populate("user_id", "handle username profile_picture_url")
      .select("user_id role created_at")
      .sort({ created_at: 1 })
      .lean();

    return res.status(200).json({ members: memberships });
  } catch (error) {
    console.error("Error in getGroupMembers:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Remove a member from a group (admin only)
export async function removeMember(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId, userId: targetUserId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }
    if (!targetUserId || !Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    // Check if requester is admin
    const adminMembership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    if (!adminMembership) {
      return res
        .status(403)
        .json({ message: "Only admins can remove members" });
    }

    // Prevent removing yourself if you're the only admin
    if (userId === targetUserId) {
      const adminCount = await OrganizationMembershipModel.countDocuments({
        org_id: new Types.ObjectId(organizationId),
        role: "admin",
      });

      if (adminCount === 1) {
        return res.status(400).json({
          message: "Cannot remove the only admin. Transfer admin rights first.",
        });
      }
    }

    const result = await OrganizationMembershipModel.findOneAndDelete({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(targetUserId),
    });

    if (!result) {
      return res.status(404).json({ message: "Member not found" });
    }

    return res.status(200).json({ message: "Member removed successfully" });
  } catch (error) {
    console.error("Error in removeMember:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Leave a group (self-remove)
export async function leaveGroup(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId } = req.params;
    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    // Check if user is a member
    const membership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
    });

    if (!membership) {
      return res
        .status(404)
        .json({ message: "You are not a member of this group" });
    }

    // Prevent last admin from leaving
    if (membership.role === "admin") {
      const adminCount = await OrganizationMembershipModel.countDocuments({
        org_id: new Types.ObjectId(organizationId),
        role: "admin",
      });

      if (adminCount === 1) {
        return res.status(400).json({
          message:
            "Cannot leave the group as the only admin. Transfer admin rights or delete the group first.",
        });
      }
    }

    await OrganizationMembershipModel.findByIdAndDelete(membership._id);

    return res.status(200).json({ message: "Successfully left the group" });
  } catch (error) {
    console.error("Error in leaveGroup:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

// Update group information (admin only)
export async function updateGroup(req: Request, res: Response) {
  try {
    const reqAny = req as any;
    const userId = reqAny.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { organizationId } = req.params;
    const { name, description, logo_url } = req.body;

    if (!organizationId || !Types.ObjectId.isValid(organizationId)) {
      return res
        .status(400)
        .json({ message: "Valid organization ID is required" });
    }

    // Check if user is admin
    const membership = await OrganizationMembershipModel.findOne({
      org_id: new Types.ObjectId(organizationId),
      user_id: new Types.ObjectId(userId),
      role: "admin",
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: "Only admins can update group information" });
    }

    const updateData: any = {};
    if (name && typeof name === "string" && name.trim().length > 0) {
      updateData.name = name.trim();
    }
    if (description !== undefined) {
      updateData.description = description;
    }
    if (logo_url !== undefined) {
      updateData.logo_url = logo_url;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const organization = await OrganizationModel.findByIdAndUpdate(
      organizationId,
      updateData,
      { new: true }
    ).select("name description logo_url");

    return res.status(200).json({
      message: "Group updated successfully",
      organization,
    });
  } catch (error) {
    console.error("Error in updateGroup:", error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
}
