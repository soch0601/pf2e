import type { ActorPF2e } from "@actor";
import type { ScenePF2e } from "@scene";
import type { TokenDocumentPF2e } from "@scene/token-document/document.ts";

export class MockToken {
    actor: ActorPF2e | null;
    readonly parent: ScenePF2e | null;
    readonly _source: foundry.documents.TokenSource;

    constructor(
        data: foundry.documents.TokenSource,
        context: { parent?: ScenePF2e | null; actor?: ActorPF2e | null } = {}
    ) {
        this._source = duplicate(data);
        this.parent = context.parent ?? null;
        this.actor = context.actor ?? null;
    }

    get id(): string {
        return this._source._id!;
    }

    get name(): string {
        return this._source.name;
    }

    get scene(): this["parent"] {
        return this.parent;
    }

    update(
        changes: EmbeddedDocumentUpdateData<TokenDocumentPF2e<this["parent"]>>,
        context: SceneEmbeddedModificationContext<NonNullable<this["parent"]>> = {}
    ): void {
        changes["_id"] = this.id;
        this.scene?.updateEmbeddedDocuments("Token", [changes], context);
    }
}
