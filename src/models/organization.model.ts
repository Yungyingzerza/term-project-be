import { Schema, model, InferSchemaType } from "mongoose";

const organizationSchema = new Schema(
  {
    name: { type: String, required: true },
    logo_url: {
      type: String,
      default: "https://api.yungying.com/isne11/uploads/1704899659167image.png",
    },
    domains: { type: [Schema.Types.Mixed], default: undefined }, // Optional: for work organizations
    description: { type: String, default: "" },
    is_work_org: { type: Boolean, default: false }, // true for work orgs (with domains), false for groups
  },
  {
    collection: "organizations",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export type Organization = InferSchemaType<typeof organizationSchema> & {
  _id: Schema.Types.ObjectId;
};
export const OrganizationModel = model("Organization", organizationSchema);
