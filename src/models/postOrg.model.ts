import { Schema, model, InferSchemaType } from "mongoose";

const postOrgSchema = new Schema(
  {
    post_id: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    org_id: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
  },
  { collection: "post_org" }
);

postOrgSchema.index({ post_id: 1, org_id: 1 }, { unique: true, name: "uq_post_org" });

export type PostOrg = InferSchemaType<typeof postOrgSchema> & { _id: Schema.Types.ObjectId };
export const PostOrgModel = model("PostOrg", postOrgSchema);

