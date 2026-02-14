import { IsOptional, IsString } from "class-validator";

export class ForgotPasswordDto {
  @IsOptional()
  @IsString()
  username?: string;
}
