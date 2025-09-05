import { Schema, model, InferSchemaType } from "mongoose";

const messageSchema = new Schema(
  {
    conversation_id: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 4000 },
  },
  {
    collection: "messages",
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

// Compound index on conversation_id + _id to allow efficient pagination by ObjectId within a conversation
messageSchema.index({ conversation_id: 1, _id: 1 }, { name: "idx_messages_convo_id" });

export type Message = InferSchemaType<typeof messageSchema> & { _id: Schema.Types.ObjectId };
export const MessageModel = model("Message", messageSchema);

