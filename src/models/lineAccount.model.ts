import { Schema, model, InferSchemaType } from "mongoose";

const lineAccountSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    line_account_id: { type: String, required: true },
  },
  {
    collection: "line_accounts",
    // No timestamps specified in the schema; omit
  }
);

lineAccountSchema.index(
  { user_id: 1, line_account_id: 1 },
  { unique: true, name: "uq_user_line_account_id" }
);

export type LineAccount = InferSchemaType<typeof lineAccountSchema> & {
  _id: Schema.Types.ObjectId;
};
export const LineAccountModel = model("LineAccount", lineAccountSchema);

