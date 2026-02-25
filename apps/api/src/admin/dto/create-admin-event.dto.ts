import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

const EVENT_LEVEL_VALUES = ["ESTADUAL", "COPA", "NACIONAL", "OPEN"] as const;
type EventLevelInput = (typeof EVENT_LEVEL_VALUES)[number];
const RATING_MATCH_FORMAT_VALUES = ["RR_K1", "K1"] as const;
type RatingMatchFormatInput = (typeof RATING_MATCH_FORMAT_VALUES)[number];

export class CreateAdminEventDto {
  @IsInt()
  @Min(1)
  cbtmEventId!: number;

  @IsString()
  nome!: string;

  @IsOptional()
  @IsIn(EVENT_LEVEL_VALUES)
  nivel?: EventLevelInput;

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

  @IsOptional()
  @IsIn(RATING_MATCH_FORMAT_VALUES)
  ratingMatchFormat?: RatingMatchFormatInput;
}
