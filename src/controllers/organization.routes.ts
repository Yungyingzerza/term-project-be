import express from "express";
import * as services from "../services/organization.services";

const organizationRouter = express.Router();

organizationRouter.get("/:organizationId", async (req, res) => {
  await services.getOrganizationDetail(req, res);
});

export default organizationRouter;

