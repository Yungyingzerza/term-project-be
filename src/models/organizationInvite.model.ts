import { Schema, model, InferSchemaType } from "mongoose";

const organizationInviteSchema = new Schema(
  {
    org_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    invite_code: { type: String, required: true },
    created_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expires_at: { type: Date, required: true },
    max_uses: { type: Number, default: null }, // null means unlimited
    current_uses: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
  },
  {
    collection: "organization_invites",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

organizationInviteSchema.index({ invite_code: 1 }, { unique: true });
organizationInviteSchema.index({ org_id: 1 });
organizationInviteSchema.index({ expires_at: 1 });

export type OrganizationInvite = InferSchemaType<
  typeof organizationInviteSchema
> & { _id: Schema.Types.ObjectId };
export const OrganizationInviteModel = model(
  "OrganizationInvite",
  organizationInviteSchema
);
