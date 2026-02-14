import { PartialType } from "@nestjs/mapped-types";
import { CreateAdminEventDto } from "./create-admin-event.dto";

export class UpdateAdminEventDto extends PartialType(CreateAdminEventDto) {}
