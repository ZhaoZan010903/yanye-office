# 砚页 YanYe

砚页是一款面向 Windows 的开源本地办公软件。名字取自砚台与书页。你可以在同一棵页面树里写 Markdown、算预算、排项目进度、画流程，再把文档大纲整理成演示文稿。

**0.2.0 已提供五类本地页面。** 按 `Ctrl+N`，选择页面类型即可开始。`Ctrl+K` 搜索工作区，`Ctrl+S` 立即保存。[产品设计说明](docs/PRODUCT_SPEC.md) · [技术架构说明](docs/ARCHITECTURE.md) · [界面与动效规范](docs/STYLE_SPEC.md)

![砚页的 Markdown 编辑界面，左侧为页面树，中间为正文，右侧为大纲及任务进度](docs/workspace.png)

## 在本机可以做什么

| 页面 | 编辑能力 | 文件交换 |
| --- | --- | --- |
| Markdown 文档 | 在富文本与源码间切换，通过 `/` 插入块，沿标题大纲定位，勾选待办 | 导入和导出 Markdown |
| 电子表格 | 多工作表、跨表公式、行列增删、填充、排序筛选、冻结首行首列、数字格式、柱状图 | CSV 交换当前表的数据，XLSX 交换多张工作表、公式及常用数字格式 |
| 多维表格 | 自定义字段、记录详情、同表关联及数值计算，同一组记录可切换表格、看板、日历 | JSON 备份保留字段结构与关联，CSV、XLSX 用于交换二维数据 |
| 流程图与白板 | 放置流程步骤、判断、起止、泳道、便签与文字，手绘、拖动节点、标注连线 | JSON 可恢复编辑，SVG、PNG 导出画面，Mermaid 导出流程结构 |
| 演示文稿 | 从本地文档生成幻灯片，增删、复制、调序，编辑版式、配图与演讲者备注，按 `F5` 放映 | 导入基础 PPTX 内容，导出可编辑的 PPTX 或逐页的 16∶9 PDF |

工作区支持子页面、收藏、移动与回收站恢复。文档保持连续书写的版式，电子表格和画布可使用更宽的操作区域。办公文件的兼容范围和各模块的使用限制见[产品设计说明](docs/PRODUCT_SPEC.md)。

## 在 Windows 上运行

开发环境使用 Node.js 24 和 pnpm 11.25.0。在 PowerShell 运行以下命令。

```powershell
git clone https://github.com/ZhaoZan010903/yanye-office.git
cd yanye-office
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` 构建界面并启动 Electron。运行 `pnpm dev` 可以单独启动 Vite 开发服务器。文件对话框和本地工作区存储由桌面主进程提供。

## 验证与打包

```powershell
pnpm test
pnpm test:desktop
pnpm package:win
```

`pnpm test` 运行模型和格式交换的单元测试。`pnpm test:desktop` 构建应用并运行 Electron 桌面流程测试。打包后保留整个 `release\YanYe-win32-x64` 目录，双击其中的 `YanYe.exe` 即可运行。

依赖安装完成后，也可以离线打包。在 PowerShell 设置 `$env:YANYE_ELECTRON_ZIP_DIR` 指向保存对应版本 Electron Windows x64 ZIP 的目录，再执行 `pnpm package:win`。打包脚本会使用已安装 Electron 包中的 SHA-256 校验和核对该文件。

## 本地数据

工作区默认写入 `%APPDATA%\YanYe\workspace.json`。要备份全部页面，可在应用关闭后复制该文件。便携程序和工作区数据分开存放。开发与测试可使用 `YANYE_PROFILE` 指定独立的数据目录。当前工作区上限为 24 MiB，嵌入的幻灯片图片也占用此空间。

## 开发路线

| 阶段 | 范围 |
| --- | --- |
| 0.1 · 本地写作 | Markdown 编辑、页面树、搜索、回收站与自动保存 |
| 0.2 · 本地办公 | 电子表格、多维表格、流程图与白板、演示文稿 |
| 后续本地里程碑 | 文档分页与 DOCX 交换，更丰富的本地编辑与格式兼容，工作区备份与恢复 |
| 最后 · 团队文档协作 | 全部本地里程碑完成后，再开发账号、共享权限、评论、多人同步与冲突处理 |

本项目按 [MIT 许可证](LICENSE) 开源。
