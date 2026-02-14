import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
  ): Promise<{ accessToken: string; role: "ADMIN" }> {
    const clientIp = request.ip ?? request.socket?.remoteAddress ?? "global";
    return this.authService.login(body.username, body.password, clientIp);
  }

  @Post("forgot-password")
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<{ success: true; message: string }> {
    return this.authService.forgotPassword(body.username ?? "");
  }

  @Post("reset-password")
  async resetPassword(@Body() body: ResetPasswordDto): Promise<{ success: true }> {
    return this.authService.resetPassword(body.token, body.password);
  }
}
