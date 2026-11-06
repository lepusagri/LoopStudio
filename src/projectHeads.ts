import type { Loop } from './music';
import type { LoopMaterial } from './loopMaterials';

type Head = { promise: Promise<string>; data?: LoopMaterial };
/** Keep newer loop attachments available while an older manifest is still being saved. */
export class ProjectHeads {
  private heads = new Map<string, Head>();
  clear() { this.heads.clear(); }
  get(id: string) { return this.heads.get(id)?.promise; }
  stage(id: string, data: LoopMaterial, promise: Promise<string>) {
    const head: Head = { data, promise };
    this.heads.set(id, head);
    this.releaseData(head);
  }
  private releaseData(head: Head) {
    void head.promise.then(() => { head.data = undefined; }, () => {});
  }
  resolve(loops: Loop[], retry: (data: LoopMaterial) => Promise<string>): Promise<Loop[]> {
    // Capture before awaiting so a later edit cannot rewrite an earlier snapshot.
    const snapshot = loops.map(loop => ({ loop, head: this.heads.get(loop.id) }));
    return Promise.all(snapshot.map(async ({ loop, head }) => {
      if (!head) return loop;
      let id: string;
      const pending=head.promise;
      try { id = await pending; }
      catch (error) {
        if(head.promise===pending){
          if (!head.data) throw error;
          head.promise = retry(head.data);
          this.releaseData(head);
        }
        id = await head.promise;
      }
      return loop.materialId === id ? loop : { ...loop, materialId: id };
    }));
  }
}
