import { Request, Response } from "express";
import { OrganizationMembershipModel, OrganizationModel, UserEmailModel } from "../models";

async function createEmail(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const { email } = req.body;
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

        if (!normalizedEmail) return res.status(400).json({ message: "Email is required" });

        const emailParts = normalizedEmail.split("@");
        if (emailParts.length !== 2) return res.status(400).json({ message: "Invalid email format" });

        const [, emailDomain] = emailParts;

        const existingEmail = await UserEmailModel.findOne({ email: normalizedEmail, user_id: reqAny.user.id });
        if (existingEmail) return res.status(409).json({ message: "Email already exists" });
        
        // If the user is trying to add a work email, ensure they belong to the organization, if this one is the first work email create new organization
        if (emailDomain) {
            let organization = await OrganizationModel.findOne({ domains: emailDomain });
            if (organization) {
                const membership = await OrganizationMembershipModel.findOne({ user_id: reqAny.user.id, org_id: organization._id });
                if (!membership) {
                    // add user to organization
                    await OrganizationMembershipModel.create({ user_id: reqAny.user.id, org_id: organization._id, role: "member" });
                }
            } else {
                // create new organization
                organization = await OrganizationModel.create({ name: emailDomain.split(".")[0], domains: [emailDomain] });
                await OrganizationMembershipModel.create({ user_id: reqAny.user.id, org_id: organization._id, role: "member" });
            }
        }

        const newEmail = await UserEmailModel.create({ email: normalizedEmail, user_id: reqAny.user.id });
        return res.status(201).json({ message: "Email created successfully", email: newEmail });
    } catch (error) {
        console.error("Error in createEmail:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

async function getEmails(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const emails = await UserEmailModel.find({ user_id: reqAny.user.id });
        return res.status(200).json({ emails });
    } catch (error) {
        console.error("Error in getEmails:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

async function deleteEmail(req: Request, res: Response) {
    try {
        const reqAny = req as any;
        if (!reqAny.user?.id) return res.status(401).json({ message: "Unauthorized" });

        const { emailId } = req.params;
        if (!emailId) return res.status(400).json({ message: "Email ID is required" });

        const email = await UserEmailModel.findOne({ _id: emailId, user_id: reqAny.user.id });
        if (!email) return res.status(404).json({ message: "Email not found" });

        await email.deleteOne();

        // delete organization membership if no more emails from that organization
        const emailParts = email.email.split("@");
        if (emailParts.length === 2) {
            const emailDomain = emailParts[1];
            const organization = await OrganizationModel.findOne({ domains: emailDomain });
            if (organization) {
                const otherEmails = await UserEmailModel.find({ user_id: reqAny.user.id });
                const hasOtherOrgEmail = otherEmails.some(e => e.email.endsWith(`@${emailDomain}`));
                if (!hasOtherOrgEmail) {
                    await OrganizationMembershipModel.deleteMany({ user_id: reqAny.user.id, org_id: organization._id });
                }
            }
        }

        return res.status(200).json({ message: "Email deleted successfully" });
    } catch (error) {
        console.error("Error in deleteEmail:", error);
        return res.status(500).json({ message: "Something went wrong!" });
    }
}

export { createEmail, getEmails, deleteEmail };
