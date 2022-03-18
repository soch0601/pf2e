import { SAVE_TYPES, SKILL_ABBREVIATIONS, SKILL_DICTIONARY, SKILL_EXPANDED } from "@actor/data/values";
import { CreaturePF2e, CharacterPF2e } from "@actor";
import { applyStackingRules, CheckModifier, ModifierPF2e, MODIFIER_TYPE, StatisticModifier } from "@actor/modifiers";
import { CheckPF2e, RollParameters } from "@system/rolls";
import { ItemSourcePF2e } from "@item/data";
import { ActiveEffectPF2e } from "@module/active-effect";
import { ItemPF2e } from "@item";
import { FamiliarData, FamiliarSystemData } from "./data";
import { CreatureSaves, LabeledSpeed } from "@actor/creature/data";
import { ActorSizePF2e } from "@actor/data/size";
import { Statistic } from "@system/statistic";
import { SaveType } from "@actor/data";
import { extractModifiers } from "@module/rules/util";

export class FamiliarPF2e extends CreaturePF2e {
    static override get schema(): typeof FamiliarData {
        return FamiliarData;
    }

    /** The familiar's master, if selected */
    get master(): CharacterPF2e | null {
        // The Actors world collection needs to be initialized for data preparation
        if (!game.ready || !this.data.data.master.id) return null;

        const master = game.actors.get(this.data.data.master.id ?? "");
        if (master instanceof CharacterPF2e) {
            master.familiar ??= this;
            return master;
        }

        return null;
    }

    override prepareData({ fromMaster = false } = {}): void {
        super.prepareData();
        if (fromMaster) this.sheet.render(false);
    }

    /** Set base emphemeral data for later updating by derived-data preparation */
    override prepareBaseData() {
        super.prepareBaseData();

        type RawSpeed = { value: string; otherSpeeds: LabeledSpeed[] };
        type PartialSystemData = DeepPartial<FamiliarSystemData> & {
            attributes: { speed: RawSpeed; flanking: {} };
            details: {};
        };

        const systemData: PartialSystemData = this.data.data;
        systemData.details.alignment = { value: "N" };
        systemData.details.level = { value: 0 };
        systemData.traits = {
            senses: [{ type: "lowLightVision", label: "PF2E.SensesLowLightVision", value: "" }],
            size: new ActorSizePF2e({ value: "tiny" }),
            traits: { value: ["minion"], custom: "" },
        };

        systemData.attributes.flanking.canFlank = false;
        systemData.attributes.perception = {};
        systemData.attributes.speed = {
            value: "25",
            label: game.i18n.localize("PF2E.SpeedTypesLand"),
            otherSpeeds: [],
        };

        systemData.skills = {};

        systemData.saves = {
            fortitude: {},
            reflex: {},
            will: {},
        };
    }

    /** Active effects on a familiar require a master, so wait until embedded documents are prepared */
    override applyActiveEffects(): void {
        return;
    }

    override prepareDerivedData(): void {
        super.prepareDerivedData();

        const master = this.master;
        this.data.data.details.level.value = master?.level ?? 0;

        // Apply active effects now that the master (if selected) is ready.
        super.applyActiveEffects();

        const data = this.data.data;

        // Ensure uniqueness of traits
        data.traits.traits.value = [...this.traits].sort();

        // Data preparation ends here unless the familiar has a master
        if (!master) return;

        const masterLevel =
            game.settings.get("pf2e", "proficiencyVariant") === "ProficiencyWithoutLevel" ? 0 : master.level;

        data.master.ability ||= "cha";
        const spellcastingAbilityModifier = master.data.data.abilities[data.master.ability].mod;

        const { synthetics } = this;
        const { statisticsModifiers } = synthetics;
        const modifierTypes: string[] = [MODIFIER_TYPE.ABILITY, MODIFIER_TYPE.PROFICIENCY, MODIFIER_TYPE.ITEM];
        const filterModifier = (modifier: ModifierPF2e) => !modifierTypes.includes(modifier.type);

        const { attributes } = data;
        attributes.speed = this.prepareSpeed("land");
        const { otherSpeeds } = data.attributes.speed;
        for (let idx = 0; idx < otherSpeeds.length; idx++) {
            otherSpeeds[idx] = this.prepareSpeed(otherSpeeds[idx].type);
        }

        // Hit Points
        {
            const perLevelModifiers = extractModifiers(statisticsModifiers, ["hp-per-level"])
                .filter(filterModifier)
                .map((modifier) => {
                    const clone = modifier.clone();
                    clone.modifier *= this.level;
                    return clone;
                });

            const modifiers = [
                new ModifierPF2e("PF2E.MasterLevelHP", this.level * 5, MODIFIER_TYPE.UNTYPED),
                extractModifiers(statisticsModifiers, ["hp"]).filter(filterModifier),
                perLevelModifiers,
            ].flat();

            const stat = mergeObject(new StatisticModifier("hp", modifiers), attributes.hp, {
                overwrite: false,
            });
            stat.max = stat.totalModifier;
            stat.value = Math.min(stat.value, stat.max);
            stat.breakdown = stat.modifiers
                .filter((m) => m.enabled)
                .map((m) => `${m.label} ${m.modifier < 0 ? "" : "+"}${m.modifier}`)
                .join(", ");
            data.attributes.hp = stat;
        }

        // Armor Class
        {
            const source = master.data.data.attributes.ac.modifiers.filter(
                (modifier) => !["status", "circumstance"].includes(modifier.type)
            );
            const base = 10 + new StatisticModifier("base", source).totalModifier;
            const modifiers = extractModifiers(statisticsModifiers, ["ac", "dex-based", "all"]).filter(filterModifier);
            const stat = mergeObject(new StatisticModifier("ac", modifiers), data.attributes.ac, {
                overwrite: false,
            });
            stat.value = base + stat.totalModifier;
            stat.breakdown = [game.i18n.format("PF2E.MasterArmorClass", { base })]
                .concat(
                    stat.modifiers
                        .filter((m) => m.enabled)
                        .map((m) => `${m.label} ${m.modifier < 0 ? "" : "+"}${m.modifier}`)
                )
                .join(", ");
            data.attributes.ac = stat;
        }

        // Saving Throws
        this.saves = SAVE_TYPES.reduce((partialSaves, saveType) => {
            const save = master.saves[saveType];
            const saveName = game.i18n.localize(CONFIG.PF2E.saves[saveType]);
            const source = save.modifiers.filter((modifier) => !["status", "circumstance"].includes(modifier.type));
            const totalMod = applyStackingRules(source);
            const selectors = save.data.domains ?? [];
            const stat = new Statistic(this, {
                slug: saveType,
                domains: selectors,
                modifiers: [
                    new ModifierPF2e(`PF2E.MasterSavingThrow.${saveType}`, totalMod, MODIFIER_TYPE.UNTYPED),
                    ...extractModifiers(statisticsModifiers, selectors).filter(filterModifier),
                ],
                check: {
                    type: "saving-throw",
                    label: game.i18n.format("PF2E.SavingThrowWithName", { saveName }),
                },
                dc: {},
            });

            return { ...partialSaves, [saveType]: stat };
        }, {} as Record<SaveType, Statistic>);

        this.data.data.saves = SAVE_TYPES.reduce(
            (partial, saveType) => ({ ...partial, [saveType]: this.saves[saveType].getCompatData() }),
            {} as CreatureSaves
        );

        // Senses
        this.data.data.traits.senses = this.prepareSenses(this.data.data.traits.senses, synthetics);

        // Attack
        {
            const modifiers = [
                new ModifierPF2e("PF2E.MasterLevel", masterLevel, MODIFIER_TYPE.UNTYPED),
                ...extractModifiers(statisticsModifiers, ["attack", "attack-roll", "all"]),
            ];
            const stat = mergeObject(new StatisticModifier("attack", modifiers), {
                roll: async ({ event, options = [], callback }: RollParameters): Promise<void> => {
                    await CheckPF2e.roll(
                        new CheckModifier("Attack Roll", stat),
                        { actor: this, type: "attack-roll", options },
                        event,
                        callback
                    );
                },
            });
            stat.value = stat.totalModifier;
            stat.breakdown = stat.modifiers
                .filter((m) => m.enabled)
                .map((m) => `${m.label} ${m.modifier < 0 ? "" : "+"}${m.modifier}`)
                .join(", ");
            data.attack = stat;
        }

        // Perception
        {
            const modifiers = [
                new ModifierPF2e("PF2E.MasterLevel", masterLevel, MODIFIER_TYPE.UNTYPED),
                new ModifierPF2e(
                    `PF2E.MasterAbility.${data.master.ability}`,
                    spellcastingAbilityModifier,
                    MODIFIER_TYPE.UNTYPED
                ),
                ...extractModifiers(statisticsModifiers, ["perception", "wis-based", "all"]).filter(filterModifier),
            ];
            const stat = mergeObject(new StatisticModifier("perception", modifiers), data.attributes.perception, {
                overwrite: false,
            });
            stat.value = stat.totalModifier;
            stat.breakdown = stat.modifiers
                .filter((m) => m.enabled)
                .map((m) => `${m.label} ${m.modifier < 0 ? "" : "+"}${m.modifier}`)
                .join(", ");
            stat.roll = async (args: RollParameters): Promise<void> => {
                const label = game.i18n.localize("PF2E.PerceptionCheck");
                await CheckPF2e.roll(
                    new CheckModifier(label, stat),
                    { actor: this, type: "perception-check", options: args.options ?? [], dc: args.dc },
                    args.event,
                    args.callback
                );
            };
            data.attributes.perception = stat;
        }

        // Skills
        for (const shortForm of SKILL_ABBREVIATIONS) {
            const longForm = SKILL_DICTIONARY[shortForm];
            const modifiers = [new ModifierPF2e("PF2E.MasterLevel", masterLevel, MODIFIER_TYPE.UNTYPED)];
            if (["acr", "ste"].includes(shortForm)) {
                modifiers.push(
                    new ModifierPF2e(
                        `PF2E.MasterAbility.${data.master.ability}`,
                        spellcastingAbilityModifier,
                        MODIFIER_TYPE.UNTYPED
                    )
                );
            }
            const ability = SKILL_EXPANDED[longForm].ability;
            modifiers.push(
                ...extractModifiers(statisticsModifiers, [longForm, `${ability}-based`, "skill-check", "all"]).filter(
                    filterModifier
                )
            );

            const label = CONFIG.PF2E.skills[shortForm] ?? longForm;
            const stat = mergeObject(new StatisticModifier(label, modifiers), {
                ability,
                value: 0,
                roll: async (args: RollParameters): Promise<void> => {
                    const label = game.i18n.format("PF2E.SkillCheckWithName", {
                        skillName: game.i18n.localize(CONFIG.PF2E.skills[shortForm]),
                    });
                    await CheckPF2e.roll(
                        new CheckModifier(label, stat),
                        { actor: this, type: "skill-check", options: args.options ?? [], dc: args.dc },
                        args.event,
                        args.callback
                    );
                },
            });
            stat.value = stat.totalModifier;
            stat.breakdown = stat.modifiers
                .filter((m) => m.enabled)
                .map((m) => `${m.label} ${m.modifier < 0 ? "" : "+"}${m.modifier}`)
                .join(", ");
            data.skills[shortForm] = stat;
        }

        // Call post-data-preparation RuleElement hooks
        for (const rule of this.rules) {
            try {
                rule.afterPrepareData?.();
            } catch (error) {
                // ensure that a failing rule element does not block actor initialization
                console.error(`PF2e | Failed to execute onAfterPrepareData on rule element ${rule}.`, error);
            }
        }
    }

    override async createEmbeddedDocuments(
        embeddedName: "ActiveEffect" | "Item",
        data: PreCreate<foundry.data.ActiveEffectSource>[] | PreCreate<ItemSourcePF2e>[],
        context: DocumentModificationContext = {}
    ): Promise<ActiveEffectPF2e[] | ItemPF2e[]> {
        const createData = Array.isArray(data) ? data : [data];
        for (const datum of data) {
            if (!("type" in datum)) continue;
            if (!["condition", "effect"].includes(datum.type ?? "")) {
                ui.notifications.error(game.i18n.localize("PF2E.FamiliarItemTypeError"));
                return [];
            }
        }

        return super.createEmbeddedDocuments(embeddedName, createData, context);
    }

    /* -------------------------------------------- */
    /*  Event Listeners and Handlers                */
    /* -------------------------------------------- */

    /** Remove the master's reference to this familiar */
    protected override _onDelete(options: DocumentModificationContext<this>, userId: string): void {
        if (this.master) this.master.familiar = null;
        super._onDelete(options, userId);
    }
}

export interface FamiliarPF2e {
    readonly data: FamiliarData;

    createEmbeddedDocuments(
        embeddedName: "ActiveEffect",
        data: PreCreate<foundry.data.ActiveEffectSource>[],
        context?: DocumentModificationContext
    ): Promise<ActiveEffectPF2e[]>;
    createEmbeddedDocuments(
        embeddedName: "Item",
        data: PreCreate<ItemSourcePF2e>[],
        context?: DocumentModificationContext
    ): Promise<ItemPF2e[]>;
    createEmbeddedDocuments(
        embeddedName: "ActiveEffect" | "Item",
        data: PreCreate<foundry.data.ActiveEffectSource>[] | Partial<ItemSourcePF2e>[],
        context?: DocumentModificationContext
    ): Promise<ActiveEffectPF2e[] | ItemPF2e[]>;
}
