export type Category = "Romantic" | "Adventure" | "Food & drink" | "Creative" | "Relaxing" | "Culture";
export type Status = "idea" | "planned" | "completed";
export type Mood = "Romantic" | "Fun" | "Relaxing" | "Adventure" | "Creative" | "Surprise me";
export type WeatherSetting = "any" | "indoor" | "outdoor";
export type HomePartner = "partner_one" | "partner_two";
export type FeelingAnswers = {
  mood: Mood;
  duration: "1" | "2" | "3" | "4";
  budget: "1" | "2" | "3" | "4";
  distance: "1" | "2" | "3" | "4";
  avoid: string;
};

export type IdeaDetails = {
  title: string;
  description: string;
  category: Category;
  duration: string;
  budget: string;
  emoji: string;
  mood: Mood;
  duration_minutes: number | null;
  budget_eur: number | null;
  travel_minutes: number | null;
  at_home: boolean;
  weather_setting: WeatherSetting;
};

// A shared catalog idea (created_by_couple_id is null) or a couple's private idea.
export type Idea = IdeaDetails & {
  id: string;
  created_by_couple_id: string | null;
  created_at: string;
};

export type DateDetails = {
  planned_for: string | null;
  completed_at: string | null;
  memory: string | null;
  rating: number | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  home_partner: HomePartner | null;
};

export type CoupleDate = DateDetails & {
  id: string;
  couple_id: string;
  idea_id: string;
  status: Exclude<Status, "idea">;
  created_at: string;
};

// What the screens show: an idea not planned yet (id is the idea's id), or a planned or
// completed date carrying its idea's details (id is the date's id).
export type DateIdea = IdeaDetails & DateDetails & {
  id: string;
  idea_id: string;
  status: Status;
  favorite: boolean;
  is_own_idea: boolean;
};

export type GeocodedPlace = {
  displayName: string;
  latitude: number;
  longitude: number;
};
