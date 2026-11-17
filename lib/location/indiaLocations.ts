import { StateData } from "./types";

// ============================================================
// Starting location dataset.
//
// HONEST SCOPE NOTE: India has 36 states/UTs, ~800 districts, and
// several thousand talukas/tehsils — hand-authoring all of it
// accurately without a verified data source would risk silently
// wrong data reaching a real form (a taluka assigned to the wrong
// district, a renamed/split district, etc.), which is worse than an
// admittedly incomplete dataset. So this file has:
//   - The complete, stable list of Indian states and union
//     territories (this doesn't change often and is safe to embed).
//   - Full district-level data for Maharashtra, since that's the
//     state used in the spec's own worked example.
//   - Taluka-level data filled in for the districts used in that
//     example (Ratnagiri, Pune) to prove the full three-level chain
//     end-to-end.
//   - Other states are listed with an empty `districts` array as a
//     clear placeholder, NOT fabricated district names.
//
// TO REACH FULL COVERAGE: replace/extend this file's `INDIA_LOCATIONS`
// array with a verified dataset — either a maintained npm package
// (search "india states districts json" for current options) or an
// official government source (e.g. data.gov.in publishes
// state/district/tehsil lists). Because every consumer in this
// codebase goes through queries.ts (getStates/getDistricts/
// getTalukas), swapping the data source later means editing ONLY
// this file — no component or form needs to change.
// ============================================================

export const INDIA_LOCATIONS: StateData[] = [
  {
    name: "Maharashtra",
    districts: [
      { name: "Mumbai City", talukas: [] },
      { name: "Mumbai Suburban", talukas: [] },
      {
        name: "Pune",
        talukas: ["Haveli", "Pune City", "Mulshi", "Maval", "Khed", "Junnar", "Shirur", "Baramati", "Indapur", "Daund", "Purandar", "Velhe", "Bhor", "Ambegaon"],
      },
      {
        name: "Ratnagiri",
        talukas: ["Chiplun", "Ratnagiri", "Sangameshwar", "Lanja", "Rajapur", "Khed", "Dapoli", "Mandangad", "Guhagar"],
      },
      { name: "Nagpur", talukas: [] },
      { name: "Nashik", talukas: [] },
      { name: "Thane", talukas: [] },
      { name: "Aurangabad", talukas: [] },
      { name: "Solapur", talukas: [] },
      { name: "Kolhapur", talukas: [] },
      { name: "Satara", talukas: [] },
      { name: "Sangli", talukas: [] },
      { name: "Ahmednagar", talukas: [] },
      { name: "Sindhudurg", talukas: [] },
      { name: "Raigad", talukas: [] },
      { name: "Palghar", talukas: [] },
      { name: "Jalgaon", talukas: [] },
      { name: "Dhule", talukas: [] },
      { name: "Nandurbar", talukas: [] },
      { name: "Beed", talukas: [] },
      { name: "Latur", talukas: [] },
      { name: "Osmanabad", talukas: [] },
      { name: "Nanded", talukas: [] },
      { name: "Parbhani", talukas: [] },
      { name: "Hingoli", talukas: [] },
      { name: "Jalna", talukas: [] },
      { name: "Buldhana", talukas: [] },
      { name: "Akola", talukas: [] },
      { name: "Washim", talukas: [] },
      { name: "Amravati", talukas: [] },
      { name: "Yavatmal", talukas: [] },
      { name: "Wardha", talukas: [] },
      { name: "Chandrapur", talukas: [] },
      { name: "Gadchiroli", talukas: [] },
      { name: "Gondia", talukas: [] },
      { name: "Bhandara", talukas: [] },
    ],
  },
  // Every other state/UT is listed so it appears in the State
  // dropdown immediately — district data is an empty placeholder
  // until filled in (see the scope note above), and the UI shows an
  // honest "no districts loaded yet for this state" empty state
  // rather than hiding the state entirely.
  { name: "Andhra Pradesh", districts: [] },
  { name: "Arunachal Pradesh", districts: [] },
  { name: "Assam", districts: [] },
  { name: "Bihar", districts: [] },
  { name: "Chhattisgarh", districts: [] },
  { name: "Goa", districts: [] },
  { name: "Gujarat", districts: [] },
  { name: "Haryana", districts: [] },
  { name: "Himachal Pradesh", districts: [] },
  { name: "Jharkhand", districts: [] },
  { name: "Karnataka", districts: [] },
  { name: "Kerala", districts: [] },
  { name: "Madhya Pradesh", districts: [] },
  { name: "Manipur", districts: [] },
  { name: "Meghalaya", districts: [] },
  { name: "Mizoram", districts: [] },
  { name: "Nagaland", districts: [] },
  { name: "Odisha", districts: [] },
  { name: "Punjab", districts: [] },
  { name: "Rajasthan", districts: [] },
  { name: "Sikkim", districts: [] },
  { name: "Tamil Nadu", districts: [] },
  { name: "Telangana", districts: [] },
  { name: "Tripura", districts: [] },
  { name: "Uttar Pradesh", districts: [] },
  { name: "Uttarakhand", districts: [] },
  { name: "West Bengal", districts: [] },
  { name: "Andaman and Nicobar Islands", districts: [] },
  { name: "Chandigarh", districts: [] },
  { name: "Dadra and Nagar Haveli and Daman and Diu", districts: [] },
  { name: "Delhi", districts: [] },
  { name: "Jammu and Kashmir", districts: [] },
  { name: "Ladakh", districts: [] },
  { name: "Lakshadweep", districts: [] },
  { name: "Puducherry", districts: [] },
];
