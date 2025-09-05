import { Request, Response } from "express";

async function example(req: Request, res: Response) {
  try {
    return res.json({
      message: "Example works!",
    });
  } catch (error) {
    return res.status(500).json({ message: "Something went wrong!" });
  }
}

export { example };
