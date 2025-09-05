import { Schema, model, InferSchemaType } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    logo_url: { type: String },
    domains: { type: [Schema.Types.Mixed], default: undefined },
  },
  {
    collection: "organizations",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export type Organization = InferSchemaType<typeof organizationSchema> & { _id: Schema.Types.ObjectId };
export const OrganizationModel = model("Organization", organizationSchema);

