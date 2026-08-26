import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AuthUser, CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
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

  @Post("revoke-sessions")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  async revokeSessions(@CurrentUser() user: AuthUser): Promise<{ success: true }> {
    return this.authService.revokeSessions(user.username);
  }
}
