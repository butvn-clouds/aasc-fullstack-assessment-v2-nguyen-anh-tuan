import { Type } from 'class-transformer';
import { IsArray, IsDefined, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class CampaignDto {
  @IsString() campaign_id: string;
  @IsOptional() @IsString() campaign_name?: string;
  @IsOptional() @IsString() ad_id?: string;
  @IsOptional() @IsString() ad_name?: string;
}
class FormDto {
  @IsString() form_id: string;
  @IsOptional() @IsString() form_name?: string;
}
class LeadDataDto {
  @IsString() full_name: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) interests?: string[];
  @IsOptional() @IsString() utm_source?: string;
  @IsOptional() @IsString() utm_campaign?: string;
  @IsOptional() @IsString() ttclid?: string;
}
class CustomQuestionDto {
  @IsString() question: string;
  @IsString() answer: string;
}

export class TikTokLeadPayloadDto {
  @IsString() event: string;
  @IsString() event_id: string;
  @IsNumber() timestamp: number;
  @IsOptional() @IsString() advertiser_id?: string;
  @IsDefined() @ValidateNested() @Type(() => CampaignDto) campaign: CampaignDto;
  @IsDefined() @ValidateNested() @Type(() => FormDto) form: FormDto;
  @IsDefined() @ValidateNested() @Type(() => LeadDataDto) lead_data: LeadDataDto;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomQuestionDto)
  custom_questions?: CustomQuestionDto[];
}

export const LEAD_EVENT = 'lead.generate';
export const INTERACTION_EVENTS = ['form.complete', 'user.interact'];
