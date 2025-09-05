import { Schema, model, InferSchemaType } from "mongoose";
import type { OrgRole } from "./enums";

const organizationMembershipSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true, enum: ["member", "admin"] satisfies OrgRole[] },
  },
  {
    collection: "organization_memberships",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

organizationMembershipSchema.index({ org_id: 1, user_id: 1 }, { unique: true, name: "uq_org_user" });

export type OrganizationMembership = InferSchemaType<typeof organizationMembershipSchema> & { _id: Schema.Types.ObjectId };
export const OrganizationMembershipModel = model("OrganizationMembership", organizationMembershipSchema);

