// DTOs for the data-import write endpoints.
//
// main.ts installs a global ValidationPipe with whitelist + forbidNonWhitelisted,
// so every accepted body field must be declared here or the request 400s. File
// uploads carry their metadata as query params instead, to stay clear of it.

import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const VALIDATION_STATUSES = [
  'valid',
  'warning',
  'error',
  'duplicate',
  'existing',
] as const;

export class ExcludeRowDto {
  @IsBoolean()
  excluded!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class ExcludeStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(VALIDATION_STATUSES, { each: true })
  statuses!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(400)
  reason?: string;
}

export class RekeyDto {
  /** A header name, or a `#N` 1-based positional reference. */
  @IsString()
  @MaxLength(200)
  naturalKeyColumn!: string;
}

export class RollbackDto {
  /**
   * Must be `ROLLBACK <first 8 chars of the run id>`.
   *
   * A typed confirmation rather than a boolean: rollback destroys promoted
   * interactions and cascades away any insights generated from them, which is
   * real LLM spend. Making the operator type the run id means they cannot roll
   * back the wrong run by muscle memory.
   */
  @IsString()
  @MaxLength(60)
  confirm!: string;
}
