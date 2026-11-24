import { z } from "zod";

export const currentUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(["viewer", "editor", "admin"]),
});

export const loginResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
});
