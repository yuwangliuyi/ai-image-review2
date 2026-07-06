import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session?.user as any;
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    // 仅管理员和审核员可下载
    const isReviewer = user.role === "REVIEWER";
    if (user.role !== "ADMIN" && !isReviewer) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    /* ═══════════════════════════════════════════
       Sheet 1: 用户汇总
       ═══════════════════════════════════════════ */
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        department: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { uploadedSpus: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 每个用户上传图片的审核统计
    const userIds = users.map((u) => u.id);
    const userImageCounts = userIds.length > 0
      ? await prisma.image.groupBy({
          by: ["uploadedById", "status"],
          where: { uploadedById: { in: userIds } },
          _count: true,
        })
      : [];

    const userImageMap: Record<string, { uploaded: number; approved: number; rejected: number; pending: number }> = {};
    for (const u of users) {
      userImageMap[u.id] = { uploaded: 0, approved: 0, rejected: 0, pending: 0 };
    }
    for (const c of userImageCounts) {
      const entry = userImageMap[c.uploadedById];
      if (!entry) continue;
      entry.uploaded += c._count;
      if (c.status === "APPROVED") entry.approved = c._count;
      else if (c.status === "REJECTED") entry.rejected = c._count;
      else entry.pending = c._count;
    }

    const roleLabel: Record<string, string> = {
      ADMIN: "管理员",
      REVIEWER: "审核员",
      UPLOADER: "上传者",
    };

    const userRows = users.map((u) => {
      const img = userImageMap[u.id];
      return {
        "姓名": u.name,
        "部门": u.department,
        "角色": roleLabel[u.role] || u.role,
        "邮箱": u.email,
        "注册时间": u.createdAt.toISOString().slice(0, 19).replace("T", " "),
        "上传SPU数": u._count.uploadedSpus,
        "上传图片张数": img.uploaded,
        "通过图片张数": img.approved,
        "驳回图片张数": img.rejected,
        "待审图片张数": img.pending,
        "审核记录数": u._count.reviews,
      };
    });

    /* ═══════════════════════════════════════════
       Sheet 2: SPU 明细
       ═══════════════════════════════════════════ */
    const spus = await prisma.spu.findMany({
      include: {
        uploadedBy: { select: { name: true, department: true } },
        assignedReviewer: { select: { name: true } },
        archive: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const spuIds = spus.map((s) => s.id);
    const spuImageCounts = spuIds.length > 0
      ? await prisma.image.groupBy({
          by: ["spuId", "status"],
          where: { spuId: { in: spuIds } },
          _count: true,
        })
      : [];

    const spuImageMap: Record<string, { total: number; approved: number; rejected: number; pending: number }> = {};
    for (const s of spus) {
      spuImageMap[s.id] = { total: 0, approved: 0, rejected: 0, pending: 0 };
    }
    for (const c of spuImageCounts) {
      const entry = spuImageMap[c.spuId];
      if (!entry) continue;
      entry.total += c._count;
      if (c.status === "APPROVED") entry.approved = c._count;
      else if (c.status === "REJECTED") entry.rejected = c._count;
      else entry.pending = c._count;
    }

    const statusLabel: Record<string, string> = {
      PENDING: "待审核",
      APPROVED: "已通过",
      REJECTED: "已驳回",
    };

    const spuRows = spus.map((s) => {
      const img = spuImageMap[s.id];
      return {
        "SPU名称": s.name,
        "品类": s.category,
        "国家风格": s.countryStyle,
        "店铺名称": s.shopName,
        "状态": statusLabel[s.status] || s.status,
        "上传者": s.uploadedBy.name,
        "上传部门": s.uploadedBy.department,
        "审核员": s.assignedReviewer?.name || "",
        "创建时间": s.createdAt.toISOString().slice(0, 19).replace("T", " "),
        "图片总数": img.total,
        "已通过": img.approved,
        "已驳回": img.rejected,
        "待审核": img.pending,
        "已归档": s.archive ? "是" : "否",
      };
    });

    /* ═══════════════════════════════════════════
       Sheet 3: 图片明细
       ═══════════════════════════════════════════ */
    const images = await prisma.image.findMany({
      include: {
        spu: { select: { name: true, category: true } },
        uploadedBy: { select: { name: true, department: true } },
        reviews: {
          include: {
            reviewer: { select: { name: true, department: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const imageStatusLabel: Record<string, string> = {
      PENDING: "待审核",
      APPROVED: "已通过",
      REJECTED: "已驳回",
    };

    const imageRows = images.map((img) => {
      const lastReview = img.reviews[0];
      return {
        "文件名": img.filename,
        "文件大小(KB)": (img.fileSize / 1024).toFixed(1),
        "文件类型": img.mimeType,
        "所属SPU": img.spu.name,
        "品类": img.spu.category,
        "上传者": img.uploadedBy.name,
        "上传部门": img.uploadedBy.department,
        "批次号": img.batchId || "",
        "审核状态": imageStatusLabel[img.status] || img.status,
        "审核人": lastReview?.reviewer.name || "",
        "审核人部门": lastReview?.reviewer.department || "",
        "审核意见": lastReview?.comment || "",
        "审核时间": lastReview ? lastReview.createdAt.toISOString().slice(0, 19).replace("T", " ") : "",
        "上传时间": img.createdAt.toISOString().slice(0, 19).replace("T", " "),
      };
    });

    /* ═══════════════════════════════════════════
       Sheet 4: 归档明细
       ═══════════════════════════════════════════ */
    const archives = await prisma.archive.findMany({
      orderBy: { archivedAt: "desc" },
    });

    const archiveRows = archives.map((a) => ({
      "SPU名称": a.spuName,
      "品类": a.category,
      "国家风格": a.countryStyle,
      "店铺名称": a.shopName,
      "上传者": a.uploadedByName,
      "部门": a.department,
      "图片数量": a.imageCount,
      "归档时间": a.archivedAt.toISOString().slice(0, 19).replace("T", " "),
    }));

    /* ═══════════════════════════════════════════
       生成 Excel
       ═══════════════════════════════════════════ */
    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(userRows);
    XLSX.utils.book_append_sheet(wb, ws1, "用户汇总");

    const ws2 = XLSX.utils.json_to_sheet(spuRows);
    XLSX.utils.book_append_sheet(wb, ws2, "SPU明细");

    const ws3 = XLSX.utils.json_to_sheet(imageRows);
    XLSX.utils.book_append_sheet(wb, ws3, "图片明细");

    const ws4 = XLSX.utils.json_to_sheet(archiveRows);
    XLSX.utils.book_append_sheet(wb, ws4, "归档明细");

    // 调整列宽（取各列最大字符宽度）
    const autoWidth = (ws: XLSX.WorkSheet) => {
      const cols: { wch: number }[] = [];
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let C = range.s.c; C <= range.e.c; C++) {
        let max = 8;
        for (let R = range.s.r; R <= range.e.r; R++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell?.v) {
            const len = String(cell.v).length;
            // 中文字符约占2个英文字符宽度
            const cnCount = (String(cell.v).match(/[\u4e00-\u9fa5]/g) || []).length;
            const w = len + cnCount * 0.8;
            if (w > max) max = w;
          }
        }
        cols.push({ wch: Math.min(max + 2, 50) });
      }
      ws["!cols"] = cols;
    };

    autoWidth(ws1);
    autoWidth(ws2);
    autoWidth(ws3);
    autoWidth(ws4);

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const now = new Date().toISOString().slice(0, 10);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="AI图片审核数据总表_${now}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
