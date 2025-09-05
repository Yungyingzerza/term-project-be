import { Schema, model, InferSchemaType } from "mongoose";

const conversationParticipantSchema = new Schema(
  {
    conversation_id: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    last_read_at: { type: Date },
  },
  { collection: "conversation_participants" }
);

conversationParticipantSchema.index(
  { conversation_id: 1, user_id: 1 },
  { unique: true, name: "uq_convo_user" }
);

export type ConversationParticipant = InferSchemaType<typeof conversationParticipantSchema> & { _id: Schema.Types.ObjectId };
export const ConversationParticipantModel = model("ConversationParticipant", conversationParticipantSchema);

