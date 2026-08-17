import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Email must be valid")
    .transform((email) => email.toLowerCase())
});

export const userIdParamSchema = z.object({
  id: z.string().uuid("Invalid user id")
});
