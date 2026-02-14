import { EventLevel } from "@prisma/client";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateAdminEventDto {
  @IsInt()
  @Min(1)
  cbtmEventId!: number;

  @IsString()
  nome!: string;

  @IsOptional()
  @IsEnum(EventLevel)
  nivel?: EventLevel;

  @IsOptional()
  @IsString()
  inicioInscricoes?: string;

  @IsOptional()
  @IsString()
  fimInscricoes?: string;

  @IsOptional()
  @IsString()
  inicioRealizacao?: string;

  @IsOptional()
  @IsString()
  fimRealizacao?: string;

  @IsOptional()
  @IsString()
  dataInicio?: string;

  @IsOptional()
  @IsString()
  dataFim?: string;

  @IsOptional()
  @IsBoolean()
  concluido?: boolean;
}
