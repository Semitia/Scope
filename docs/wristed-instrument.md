# 实时腕式器械构型

在浏览器中选择 **Add panel → Wristed instrument**。无需数据源即可看到手动预览；点击 **Configure** 设置构型、尺寸和通道绑定。鼠标左键旋转，Ctrl + 滚轮缩放，右键平移，**Fit** 恢复完整构型视图，**Wrist** 将镜头对准腕关节与夹爪细节。面板支持拖动、调整大小、折叠及工作区配置导入导出。

面板右上角的 **线条 / 模型** 按钮切换显示方式，选择随工作区保存。模型由本机 Blender 根据参考视频近似制作，包含灰白外壳、多孔金属杆身、腕部铰链和双钳口；模型模式下，两段连续体采用不透明、两端封闭的黑色外表面，并随原有曲率实时弯曲；线条模式仍显示骨架工程线图。两种显示方式使用相同的姿态、尺寸与通道绑定，模型的钳口随 `alpha` 开合。模型加载失败时显示提示并回退到线条。可编辑源文件与重建方法见 [Blender 模型说明](../models/wristed/README.md)。

使用现有 Python SDK 发送一组具名参数：

```python
from debugscope import Scope

scope = Scope("wristed-instrument")
scope.frame({"instrument": {
    "l": 160, "phi": 0, "theta1": 0.7, "delta1": 0.3,
    "beta1": 0.25, "beta2": -0.2, "alpha": 0.5235987756,
}})
```

SDK 将字典展开为 `instrument.l` … `instrument.alpha`。选择该程序后，在 Configure 的 **Bind channel group** 下拉框中选择 `instrument · named`，一次绑定全部 7 路。可以同时发送 `left`、`right` 等多组构型，分别选择对应的组。没有前缀的根级命名参数也支持整组绑定。

也支持七维数组：`scope.frame({"pose": [l, phi, theta1, delta1, beta1, beta2, alpha]})`，选择 `pose · vector [0…6]` 即可按数字索引绑定。旧的 `psi.0` … `psi.5` 配合同前缀下的 `alpha` 或 `angle` 仍可整组选择。

整组选择仅列出完整组，不会混合不同前缀中的参数。单路下拉框可继续覆盖个别绑定；**Use manual values** 解除全部绑定并恢复手动输入。绑定随工作区保存，重新加载后恢复。

| 输入 | 含义 | 默认单位 |
| --- | --- | --- |
| `l` | 插入长度 | mm |
| `phi` | 基座绕 Z 轴旋转 | rad |
| `theta1` | 连续体总弯曲角 | rad |
| `delta1` | 弯曲方向 | rad |
| `beta1` | 第一腕关节绕局部 X 轴旋转 | rad |
| `beta2` | 第二腕关节绕局部 Y 轴旋转 | rad |
| `alpha` | 夹爪**总**开合角；两爪分别绕局部 Y 轴旋转 ±alpha/2 | rad |

**Angular inputs** 可以切换为 degrees，同时转换已有手动角度值。绑定通道的数值按所选单位解释。尺寸中的固定腕部偏角 γ 始终以 rad 表示。

**Instrument dimensions** 中的默认值来自 `WristedInstrPython/wristedInstrConfig.py`：连续段 100 mm、刚性连接 42.4 / 8.89 mm、ζ = 0.15、d = 8 mm、γ = 1.3 rad；骨架半径 4.2 mm、夹爪长 9 mm 来自绘图代码。原来的 `seg[3] = 5` 未参与 `PlotWristedSnake` 的绘制，因此这里不提供该无效绘图参数。

实现保留了 `PlotWristedSnake` 的插入长度分配、常曲率构型、8 根骨架、端面、半圆关节及夹爪。原图将夹爪角固定为 π/6，这里改为传入 `alpha`。刚性腕部仍遵循原绘图函数的完整长度绘制规则；该控件用于构型显示，不执行机械限位或逆运动学。

暂停后，绑定通道的构型冻结，仍可调整相机及手动参数。绑定缺失、非有限输入或超出显示范围时保留最后有效构型并显示提示。插入长度支持绝对值不超过 10000 mm，角度输入转换后支持绝对值不超过 200π rad。默认预览不表示实时测量。

渲染需要 WebGL 2。3D 模块按需加载，几何缓冲复用，构型或相机发生变化时才绘制；折叠/删除面板释放 GPU 资源。视口在所有主题下均为纯白背景。线条模式采用无光照的工程线图：骨架与夹爪使用抗锯齿、屏幕固定线宽的线条，关节保留两圈轮廓及原图的连接线，端面使用淡透明填充。放大时不会变成遮挡结构的粗管或不透明色块。模型模式使用有光照的金属与聚合物材质。画布内的拖动、Ctrl + 滚轮及右键事件不会冒泡至工作区，并阻止浏览器默认拖选、拖拽与菜单。按住 Shift + 左键也可平移。浅色、深色主题预览分别见 `artifacts/wristed-instrument-light.png` 和 `artifacts/wristed-instrument-dark.png`。

测试中的 `tests/fixtures/wristed-python.json` 由原 Python `PlotWristedSnake`（默认尺寸、夹爪 π/6）生成，涵盖 6 组构型并对比全部关键坐标变换。浏览器测试覆盖手动调整、通道绑定、暂停、线条／模型切换、模型开合、加载失败回退、旧配置兼容、配置恢复和折叠后重新挂载。

工程线图预览：`artifacts/wristed-line-overview.png`、`artifacts/wristed-line-detail.png`。

末端局部坐标系位于第二腕关节之后、夹爪分叉根部（`wrist2`），随 `phi/theta1/delta1/beta1/beta2` 运动。红 X、绿 Y、蓝 Z，带箭头与字母标记；`alpha` 只改变两爪开合，不改变该公共坐标系。

模型预览：`artifacts/wristed-model.png`、`artifacts/wristed-model-detail.png`。
