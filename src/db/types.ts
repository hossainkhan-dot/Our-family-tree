export type Status = "verified" | "unverified" | "estimated" | "unknown";
export type Sex = "male" | "female" | "other" | "unknown";
export type ParentKind = "biological" | "adoptive" | "step" | "foster" | "guardian" | "unknown";
export type DateQualifier = "exact" | "about" | "before" | "after" | "between" | "unknown";
export type EventType =
  | "birth" | "death" | "burial" | "marriage" | "divorce" | "residence" | "migration"
  | "education" | "occupation" | "achievement" | "property" | "family_history" | "other";

interface Base { id: string; created_at: string; updated_at: string; created_by: string | null; deleted_at: string | null }

export interface Person extends Base {
  sex: Sex; living_status: "living" | "deceased" | "unknown";
  branch_id: string | null; is_placeholder: 0 | 1; note: string | null; status: Status;
}
export interface PersonName extends Base {
  person_id: string; kind: string; language: "bn" | "en" | "other";
  full_name: string; given_name: string | null; family_name: string | null; is_primary: 0 | 1; status: Status;
}
export interface ParentChild extends Base {
  parent_id: string; child_id: string; kind: ParentKind;
  parent_role: "father" | "mother" | "parent"; union_id: string | null; note: string | null; status: Status;
}
export interface FamilyUnion extends Base {
  partner1_id: string | null; partner2_id: string | null;
  kind: "marriage" | "partnership" | "unknown";
  end_reason: "divorce" | "death" | "annulled" | "separated" | null; note: string | null; status: Status;
}
export interface FamilyEvent extends Base {
  type: EventType; person_id: string | null; union_id: string | null;
  title: string | null; description: string | null; place_id: string | null;
  d_text: string | null; d_calendar: "gregorian" | "bengali" | "hijri" | "other";
  d_qualifier: DateQualifier;
  d_y: number | null; d_m: number | null; d_d: number | null;
  d_end_y: number | null; d_end_m: number | null; d_end_d: number | null; status: Status;
}
