import {
  collection,
  limit,
  orderBy,
  query,
  where,
  type Query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export function notificationsCollection(tenantId: string) {
  return collection(db, "tenants", tenantId, "notifications");
}

export function userUnreadNotificationsQuery(tenantId: string, uid: string): Query {
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "user"),
    where("targetUserId", "==", uid),
    where("status", "==", "unread")
  );
}

export function roleUnreadNotificationsQuery(
  tenantId: string,
  roleLower: string,
  clientId: string | undefined
): Query {
  if (roleLower === "client" && clientId) {
    return query(
      notificationsCollection(tenantId),
      where("targetType", "==", "role"),
      where("targetRole", "==", "client"),
      where("clientId", "==", clientId),
      where("status", "==", "unread")
    );
  }
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "role"),
    where("targetRole", "==", roleLower),
    where("status", "==", "unread")
  );
}

export function userNotificationsFeedQuery(tenantId: string, uid: string, max: number): Query {
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "user"),
    where("targetUserId", "==", uid),
    orderBy("createdAt", "desc"),
    limit(max)
  );
}

export function roleNotificationsFeedQuery(
  tenantId: string,
  roleLower: string,
  clientId: string | undefined,
  max: number
): Query {
  if (roleLower === "client" && clientId) {
    return query(
      notificationsCollection(tenantId),
      where("targetType", "==", "role"),
      where("targetRole", "==", "client"),
      where("clientId", "==", clientId),
      orderBy("createdAt", "desc"),
      limit(max)
    );
  }
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "role"),
    where("targetRole", "==", roleLower),
    orderBy("createdAt", "desc"),
    limit(max)
  );
}

export function userRecentUnreadQuery(tenantId: string, uid: string, max: number): Query {
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "user"),
    where("targetUserId", "==", uid),
    where("status", "==", "unread"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
}

export function roleRecentUnreadQuery(
  tenantId: string,
  roleLower: string,
  clientId: string | undefined,
  max: number
): Query {
  if (roleLower === "client" && clientId) {
    return query(
      notificationsCollection(tenantId),
      where("targetType", "==", "role"),
      where("targetRole", "==", "client"),
      where("clientId", "==", clientId),
      where("status", "==", "unread"),
      orderBy("createdAt", "desc"),
      limit(max)
    );
  }
  return query(
    notificationsCollection(tenantId),
    where("targetType", "==", "role"),
    where("targetRole", "==", roleLower),
    where("status", "==", "unread"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
}
