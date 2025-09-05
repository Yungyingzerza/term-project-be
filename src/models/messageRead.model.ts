import { Schema, model, InferSchemaType } from "mongoose";

const messageReadSchema = new Schema(
  {
    message_id: { type: Schema.Types.ObjectId, ref: "Message", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    read_at: { type: Date, required: true },
  },
  { collection: "message_reads" }
);

messageReadSchema.index({ message_id: 1, user_id: 1 }, { unique: true, name: "uq_message_user_read" });

export type MessageRead = InferSchemaType<typeof messageReadSchema> & { _id: Schema.Types.ObjectId };
export const MessageReadModel = model("MessageRead", messageReadSchema);

