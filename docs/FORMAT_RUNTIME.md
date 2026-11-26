# 本地格式转换引擎

完整离线便携包中，`YanYe.exe` 与 `LibreOffice` 文件夹放在一起。整包解压后启动砚页，就可以在文件中心打开、创建和保存 DOC、RTF、ODT、XLS、ODS、PPT 和 ODP。在编辑器按 Ctrl+Shift+S 可以选择同一类文档的其他格式。DOCX、XLSX、XLSM、PPTX 使用砚页自带的读写器。

轻量安装包和轻量便携包可使用本机已安装的 LibreOffice。自定义路径可通过环境变量 `YANYE_LIBREOFFICE` 指定 `soffice.com` 的绝对路径。转换在临时目录和独立用户配置中运行，禁用文档宏。完成或失败后清理临时文件。文件中心保留覆盖前的上一份原件。

早期 Office 与 OpenDocument 格式需要转换为编辑器模型，再转换回所选格式。字体替代、复杂域、动画或公式的表现取决于源格式和目标格式。编辑旧档案时，可以用「另存为」生成 DOCX、XLSX 或 PPTX。加密文件需要先在原应用中解密。XLS 的范围上限仍是 65,536 行、256 列。

## 0.10 Windows 实测

七种新增格式均经桌面程序的文件接口新建，核验文件头后再打开，读回正文粗体、工作表公式或演示文字。在砚页工作区实际编辑并保存 DOC、XLS、PPT，然后让 WPS 及 Microsoft Office 在同一路径上依次修改、保存，最后由 WPS 复开。两端均读到上一步改动，DOC 粗体、XLS 的 `=A1*2` 与结果 42、PPT 的 18 磅文字均通过。REA 对这些旧二进制样本返回不支持的文件类型，验收脚本保留该结果及每版文件的 SHA-256。RTF 和三种 OpenDocument 格式本轮验证了砚页本地转换，未做两款外部套件的逐项排版比对。[桌面文件用例](../test/format-desktop.mjs) · [原应用同文件用例](../test/format-native.ps1)

## 来源和许可

完整包附带 The Document Foundation 发布的 Windows x64 LibreOffice 26.8.3.1。转换程序、资源、字体和适用的运行库取自该版本的官方发行包。LibreOffice 作为独立进程运行。其版权、适用条款和第三方组件说明随附于 `LibreOffice/LICENSE.html`、`LibreOffice/license.txt`、`LibreOffice/NOTICE` 及相应组件的目录中。[LibreOffice 许可说明](https://www.libreoffice.org/licenses/) · [26.8.3.1 对应源代码](https://download.documentfoundation.org/libreoffice/src/26.8.3/libreoffice-26.8.3.1.tar.xz) · [同版本其他源码包](https://download.documentfoundation.org/libreoffice/src/26.8.3/) · [文件过滤器列表](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html)

构建完整 ZIP 时，先执行 `pnpm package:win`，再执行 `pnpm package:win:full "D:\path\to\LibreOffice"`。该目录需包含可独立运行的 program、share 和随发行附带的许可文件。从 Windows MSI 提取时，需将随包的 x64 VC 运行库置于 program、字体置于 share/fonts/truetype。生成的 ZIP 位于 release 目录。
