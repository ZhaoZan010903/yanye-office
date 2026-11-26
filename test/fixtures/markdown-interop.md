# 归档校样

## 编辑记录

本次校对使用同一份文稿。审阅状态：初稿。

文字的出处见[排版手册][guide]，另一处也引用[同一本手册][GUIDE]。首次记录[^ink]，复核时再次引用[^ink]。

## 文件流转

```flow
st=>start: 起草
op=>operation: 校对正文
cond=>condition: 通过？
e=>end: 归档
st->op->cond
cond(yes)->e
cond(no)->op
```

```sequence
Title: 稿件复核
作者->编辑: 提交初稿
Note right of 编辑: 对照原文
编辑-->作者: 返回意见
```

## 参考资料

[guide]: https://example.org/handbook "排版手册"

[^ink]: 初次校样记录。同一条脚注可以由正文的两处引用。
