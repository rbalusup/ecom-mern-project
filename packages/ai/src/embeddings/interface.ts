export interface IEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}
