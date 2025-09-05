import { Schema, model, InferSchemaType } from "mongoose";

const conversationSchema = new Schema(
  {
    name: { type: String },
    avatar: { type: String },
    last_message_id: { type: Schema.Types.ObjectId, ref: "Message" },
    last_message_at: { type: Date },
  },
  {
    collection: "conversations",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

conversationSchema.index({ updated_at: 1 }, { name: "idx_conversations_updated" });

export type Conversation = InferSchemaType<typeof conversationSchema> & { _id: Schema.Types.ObjectId };
export const ConversationModel = model("Conversation", conversationSchema);

