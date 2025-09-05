import { Schema, model, InferSchemaType } from "mongoose";

const userEmailSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true },
  },
  {
    collection: "user_emails",
    // No timestamps defined in spec besides implicit id; omit for this collection.
  }
);

userEmailSchema.index({ user_id: 1, email: 1 }, { unique: true, name: "uq_user_email" });

export type UserEmail = InferSchemaType<typeof userEmailSchema> & { _id: Schema.Types.ObjectId };
export const UserEmailModel = model("UserEmail", userEmailSchema);

