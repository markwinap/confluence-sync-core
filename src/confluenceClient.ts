import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, isAxiosError } from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import { Config } from "./config";
import { ContentType, RemoteAttachment, RemoteContent } from "./types";

interface PageResult<T> { results: T[]; _links?: { next?: string } }

export class ConfluenceClient {
  private readonly http: AxiosInstance;
  constructor(private readonly config: Config) {
    this.http = axios.create({ baseURL: config.baseUrl, auth: { username: config.email, password: config.token }, timeout: 60000, headers: { Accept: "application/json", "User-Agent": "ConfluenceDocumentationSync/1.0" } });
  }

  async getContent(id: string, type: ContentType): Promise<RemoteContent> {
    const plural = type === "database" ? "databases" : `${type}s`;
    const params = type === "page" ? { "body-format": "storage" } : undefined;
    return (await this.request<RemoteContent>({ method: "GET", url: `/wiki/api/v2/${plural}/${id}`, params })).data;
  }

  async getDescendants(pageId: string): Promise<RemoteContent[]> {
    const found = new Map<string, RemoteContent>();
    const queue: Array<{ id: string; type: ContentType }> = [{ id: pageId, type: "page" }];
    while (queue.length) {
      const current = queue.shift()!;
      const plural = current.type === "database" ? "databases" : `${current.type}s`;
      const batch = await this.paginate<RemoteContent>(`/wiki/api/v2/${plural}/${current.id}/descendants`, { depth: 10, limit: 100 });
      for (const item of batch) {
        const normalized = { ...item, id: String(item.id) };
        if (!found.has(normalized.id)) found.set(normalized.id, normalized);
        if (item.depth === 10) queue.push({ id: normalized.id, type: normalized.type });
      }
    }
    return [...found.values()];
  }

  async getAttachments(pageId: string): Promise<RemoteAttachment[]> {
    const rows = await this.paginate<any>(`/wiki/api/v2/pages/${pageId}/attachments`, { limit: 100 });
    const attachments: RemoteAttachment[] = [];
    for (const row of rows) {
      const detail = (await this.request<any>({ method: "GET", url: `/wiki/api/v2/attachments/${row.id}` })).data;
      attachments.push({ id: String(row.id), title: detail.title || row.title, fileId: detail.fileId || row.fileId, mediaType: detail.mediaType || row.mediaType, fileSize: detail.fileSize || row.fileSize, version: detail.version || row.version, downloadLink: detail.downloadLink || detail._links?.download });
    }
    return attachments;
  }

  async downloadAttachment(pageId: string, attachment: RemoteAttachment): Promise<Buffer> {
    const endpoint = `/wiki/rest/api/content/${pageId}/child/attachment/${attachment.id}/download`;
    const redirect = await this.request<ArrayBuffer>({ method: "GET", url: endpoint, responseType: "arraybuffer", headers: { Accept: "*/*" }, maxRedirects: 0, validateStatus: status => status === 302 || (status >= 200 && status < 300), delay: "attachment" });
    if (redirect.status !== 302) return Buffer.from(redirect.data);
    const location = redirect.headers.location;
    if (!location) throw new Error(`Attachment ${attachment.id} returned a redirect without a Location header`);
    return Buffer.from((await axios.get<ArrayBuffer>(new URL(location, this.config.baseUrl).href, { responseType: "arraybuffer", timeout: 60000 })).data);
  }

  async createPage(spaceId: string, title: string, parentId: string | undefined, storage: string): Promise<RemoteContent> {
    return (await this.request<RemoteContent>({ method: "POST", url: "/wiki/api/v2/pages", data: { spaceId, status: "current", title, parentId, body: { representation: "storage", value: storage } } })).data;
  }

  async updatePage(id: string, title: string, version: number, storage: string): Promise<RemoteContent> {
    return (await this.request<RemoteContent>({ method: "PUT", url: `/wiki/api/v2/pages/${id}`, data: { id, status: "current", title, body: { representation: "storage", value: storage }, version: { number: version + 1, message: "Synchronized from ConFluenceDocumentationSync" } } })).data;
  }

  async uploadAttachment(pageId: string, file: string, existingId?: string): Promise<void> {
    const form = new FormData();
    form.append("file", createReadStream(file));
    const url = existingId ? `/wiki/rest/api/content/${pageId}/child/attachment/${existingId}/data` : `/wiki/rest/api/content/${pageId}/child/attachment`;
    await this.request({ method: "POST", url, data: form, headers: { ...form.getHeaders(), "X-Atlassian-Token": "no-check" }, delay: "attachment", maxBodyLength: Infinity });
  }

  private async paginate<T>(url: string, params?: Record<string, unknown>): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = url;
    let first = true;
    while (next) {
      const response: { data: PageResult<T> } = await this.request<PageResult<T>>({ method: "GET", url: next, params: first ? params : undefined });
      results.push(...response.data.results);
      next = response.data._links?.next;
      first = false;
    }
    return results;
  }

  private async request<T = unknown>(request: AxiosRequestConfig & { delay?: "attachment" }): Promise<AxiosResponse<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt || request.delay) await this.pause(request.delay === "attachment");
      try { return await this.http.request<T>(request); }
      catch (error) {
        lastError = error;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        if (status && status < 500 && status !== 429) throw this.friendlyError(error);
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    throw this.friendlyError(lastError);
  }

  private async pause(attachment: boolean): Promise<void> {
    const min = attachment ? this.config.attachmentMinDelayMs : this.config.minDelayMs;
    const max = attachment ? this.config.attachmentMaxDelayMs : this.config.maxDelayMs;
    await new Promise(resolve => setTimeout(resolve, min + Math.floor(Math.random() * (max - min + 1))));
  }

  private friendlyError(error: unknown): Error {
    if (!isAxiosError(error)) return error instanceof Error ? error : new Error(String(error));
    const detail = typeof error.response?.data === "object" ? JSON.stringify(error.response.data) : String(error.response?.data || error.message);
    return new Error(`Confluence API ${error.response?.status || "network error"}: ${detail}`);
  }
}
