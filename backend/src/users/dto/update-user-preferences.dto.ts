import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/** Colour schemes supported by the frontend theme system (#1170). */
export const THEME_VARIANTS = [
  'light',
  'dark',
  'high-contrast',
  'system',
] as const;

/** Accent palettes supported by the frontend theme system (#1170). */
export const THEME_ACCENTS = [
  'emerald',
  'teal',
  'blue',
  'indigo',
  'violet',
  'amber',
  'rose',
  'slate',
] as const;

/** Font size scales supported by the frontend theme system (#1170). */
export const THEME_FONT_SIZES = [
  'small',
  'medium',
  'large',
  'extra-large',
] as const;

/** Contrast levels supported by the frontend theme system (#1170). */
export const THEME_CONTRAST_LEVELS = ['normal', 'high', 'extra-high'] as const;

const HSL_TRIPLET = /^\s*\d{1,3}\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%\s*$/;

/**
 * Appearance preferences stored on the user profile so the theme follows the
 * user across devices.
 */
export class ThemePreferencesDto {
  @ApiProperty({ enum: THEME_VARIANTS })
  @IsIn(THEME_VARIANTS)
  variant: string;

  @ApiProperty({ enum: THEME_ACCENTS })
  @IsIn(THEME_ACCENTS)
  accent: string;

  @ApiProperty({ enum: THEME_FONT_SIZES })
  @IsIn(THEME_FONT_SIZES)
  fontSize: string;

  @ApiProperty({ enum: THEME_CONTRAST_LEVELS })
  @IsIn(THEME_CONTRAST_LEVELS)
  contrast: string;

  @ApiPropertyOptional({
    description: 'Custom brand colour as an "H S% L%" triplet',
    example: '142 50% 24%',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customBrandColor?: string;

  @ApiPropertyOptional({
    description: 'Dark-scheme counterpart of the custom brand colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customBrandColorDark?: string;

  @ApiPropertyOptional({
    description: 'Readable foreground for the custom brand colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customBrandFg?: string;

  @ApiPropertyOptional({
    description: 'Readable foreground for the dark-scheme brand colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customBrandFgDark?: string;

  @ApiPropertyOptional({
    description: 'Custom accent colour as an "H S% L%" triplet',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customAccentColor?: string;

  @ApiPropertyOptional({
    description: 'Dark-scheme counterpart of the custom accent colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customAccentColorDark?: string;

  @ApiPropertyOptional({
    description: 'Readable foreground for the custom accent colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customAccentFg?: string;

  @ApiPropertyOptional({
    description: 'Readable foreground for the dark-scheme accent colour',
  })
  @IsOptional()
  @IsString()
  @Matches(HSL_TRIPLET)
  customAccentFgDark?: string;

  @ApiPropertyOptional({
    description:
      'ISO timestamp of the last change — used to resolve sync conflicts',
  })
  @IsOptional()
  @IsISO8601()
  updatedAt?: string;
}

/**
 * Body of `PATCH /users/me`. Any subset of the profile can be updated; the
 * appearance preferences are validated against the theme allow-lists.
 */
export class UpdateUserPreferencesDto {
  @ApiPropertyOptional({ type: ThemePreferencesDto })
  @IsOptional()
  @Type(() => ThemePreferencesDto)
  themePreferences?: ThemePreferencesDto;

  @ApiPropertyOptional({
    description: 'Preferred display currency',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  preferredCurrency?: string;
}
