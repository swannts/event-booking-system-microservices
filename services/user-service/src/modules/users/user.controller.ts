import type { NextFunction, Request, Response } from "express";
import { sendCreated, sendOk } from "../../utils/response";
import { createUserSchema, userIdParamSchema } from "./user.schema";
import type { UsersService } from "./user.service";
import { paginationQuerySchema } from "@event-booking/contracts";

export class UserController {
  constructor(private readonly service: UsersService) {}

  createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createUserSchema.parse(req.body);
      const user = await this.service.createUser(input);
      sendCreated(res, user);
    } catch (error) {
      next(error);
    }
  };

  listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await this.service.listUsers(paginationQuerySchema.parse(req.query));
      sendOk(res, users);
    } catch (error) {
      next(error);
    }
  };

  getUserById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const user = await this.service.getUserById(id);
      sendOk(res, user);
    } catch (error) {
      next(error);
    }
  };
}
