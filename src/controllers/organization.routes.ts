import express from "express";
import getUserIdFromToken from "../middlewares/getUserIdFromToken";
import * as services from "../services/organization.services";

const organizationRouter = express.Router();

organizationRouter.get("/:organizationId", async (req, res) => {
  await services.getOrganizationDetail(req, res);
});

// Protected routes (require authentication)
organizationRouter.use(getUserIdFromToken);

organizationRouter.post("/", async (req, res) => {
  await services.createGroup(req, res);
});

organizationRouter.post("/:organizationId/invites", async (req, res) => {
  await services.createInviteCode(req, res);
});

organizationRouter.get("/:organizationId/invites", async (req, res) => {
  await services.getInviteCodes(req, res);
});

organizationRouter.delete("/invites/:inviteCode", async (req, res) => {
  await services.revokeInviteCode(req, res);
});

organizationRouter.post("/join/:inviteCode", async (req, res) => {
  await services.joinGroupWithInvite(req, res);
});

organizationRouter.get("/:organizationId/members", async (req, res) => {
  await services.getGroupMembers(req, res);
});

organizationRouter.delete(
  "/:organizationId/members/:userId",
  async (req, res) => {
    await services.removeMember(req, res);
  }
);

organizationRouter.post("/:organizationId/leave", async (req, res) => {
  await services.leaveGroup(req, res);
});

organizationRouter.patch("/:organizationId", async (req, res) => {
  await services.updateGroup(req, res);
});

export default organizationRouter;
