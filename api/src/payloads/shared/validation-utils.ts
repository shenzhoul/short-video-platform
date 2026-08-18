import { applyDecorators } from "@nestjs/common";
import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

// Strong password validation for hashed passwords (client-side validation handles complexity)
export const HashedPassword = (minLength = 8, maxLength = 100) => applyDecorators(
  IsString(),
  IsNotEmpty(),
  MinLength(minLength, { message: `Password must be at least ${minLength} characters` }),
  MaxLength(maxLength, { message: `Password cannot exceed ${maxLength} characters` })
);