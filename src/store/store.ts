// Where a village is kept. The API speaks only to this interface, so the same code runs on a
// laptop with test data (memoryStore.ts) and in Google Cloud with Firestore (firestoreStore.ts).

import type { Application, Member, Message, Post, PostResponse, Village } from "../domain/types.ts";

export interface Store {
  getVillage(villageId: string): Promise<Village | null>;
  putVillage(village: Village): Promise<void>;

  getMember(villageId: string, userId: string): Promise<Member | null>;
  listMembers(villageId: string): Promise<Member[]>;
  /** Every village the user is in. */
  membershipsOf(userId: string): Promise<Member[]>;
  putMember(member: Member): Promise<void>;

  getApplication(villageId: string, applicationId: string): Promise<Application | null>;
  listApplications(villageId: string): Promise<Application[]>;
  /** Applications from one user, in every village. */
  applicationsOf(userId: string): Promise<Application[]>;
  putApplication(application: Application): Promise<void>;

  getPost(villageId: string, postId: string): Promise<Post | null>;
  listPosts(villageId: string): Promise<Post[]>;
  putPost(post: Post): Promise<void>;
  /** Removes the post with its answers and messages. */
  deletePost(villageId: string, postId: string): Promise<void>;

  listResponses(villageId: string, postId?: string): Promise<PostResponse[]>;
  putResponse(response: PostResponse): Promise<void>;
  deleteResponse(villageId: string, postId: string, userId: string): Promise<void>;

  listMessages(villageId: string, postId?: string): Promise<Message[]>;
  putMessage(message: Message): Promise<void>;
}
