import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleProfile } from "../fakes.js";
import { disclosurePlan, isProhibitedField } from "../../src/domain/disclosure-form.js";

describe("disclosure form", () => {
  it("fills allowed fields and leaves prohibited ones blank", () => {
    const profile = sampleProfile();
    profile.formData = {
      ...profile.formData,
      firstName: "Max",
      lastName: "Mustermann",
      street: "Badstraße",
      houseNumber: "4",
      postcode: "13357",
      city: "Berlin",
      email: "max@example.com",
      employmentStatus: "FIXED_TERM",
      rentArrears: "TRUE",
    };
    const plan = disclosurePlan(
      ["Vorname", "Straße", "Hausnummer", "Beruf", "Familienstand", "Religion", "Schwangerschaft", "Bisheriger Vermieter", "Staatsangehörigkeit", "Mietrückstände"],
      profile,
    );
    const byName = new Map(plan.fields.map((field) => [field.name, field]));
    assert.equal(byName.get("Vorname")?.action, "fill");
    assert.equal(byName.get("Vorname")?.value, "Max");
    assert.equal(byName.get("Straße")?.value, "Badstraße");
    assert.equal(byName.get("Hausnummer")?.value, "4");
    assert.equal(byName.get("Beruf")?.value, "befristet");
    assert.equal(byName.get("Mietrückstände")?.value, "Ja");
    assert.equal(byName.get("Familienstand")?.action, "blank");
    assert.equal(byName.get("Religion")?.action, "blank");
    assert.equal(byName.get("Schwangerschaft")?.action, "blank");
    assert.equal(byName.get("Bisheriger Vermieter")?.action, "blank");
    assert.equal(byName.get("Staatsangehörigkeit")?.action, "skip");
    assert.equal(isProhibitedField("ethnische Herkunft"), true);
    assert.equal(isProhibitedField("Staatsangehörigkeit"), false);
  });

  it("joins the house number onto the street when the form has no separate field", () => {
    const profile = sampleProfile();
    profile.formData = { ...profile.formData, street: "Badstraße", houseNumber: "4" };
    const plan = disclosurePlan(["Straße und Hausnummer"], profile);
    assert.equal(plan.fields[0]?.value, "Badstraße 4");
  });
});
