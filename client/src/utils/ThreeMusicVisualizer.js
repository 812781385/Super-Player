import * as THREE from "three";
import { OrbitControls } from "../lib/OrbitControls.js";
import { GUI } from "../lib/dat.gui.module.js";
import { EffectComposer } from "../lib/EffectComposer.js";
import { RenderPass } from "../lib/RenderPass.js";
import { UnrealBloomPass } from "../lib/UnrealBloomPass.js";
import { ShaderPass } from "../lib/ShaderPass.js";
import { CopyShader } from "../lib/CopyShader.js";

import { range } from "../components/range.js";
import { node } from "../components/node.js";
import { randomRange } from "../components/randomRange.js";
import { Triangle } from "../components/Triangle.js";

export class ThreeMusicVisualizer {
  constructor(options = {}) {
    this.options = {
      positionZ: 80,
      N: 256,
      ...options
    }
    
    // 初始化引用
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;

    this.composer = null;
    this.audioContext = null; // Web Audio API上下文
    this.audioBuffer = null;  // 原始音频Buffer
    this.audioSource = null;  // 音频源节点
    this.analyserNode = null; // 分析节点
    this.linesGroup = null;
    this.outLine = null;
    this.inLine = null;
    this.barLine = [];
    this.barNodes = null;
    this.barGroup = null;
    this.Triangles = [];
    this.TriangleGroup = null;
    this.scale = 1;
    
    // GUI配置
    this.gui = {
      R: 20,
      G: 90,
      B: 225,
      TrianglesBgColor: 0x03a9f4,
      TrianglesLineColor: 0x03a9f4,
      lineColor: 0x00ffff,
      rotate: false
    };
    
    // 音频时间跟踪变量
    this._playStartTime = null;
    this._pauseDuration = 0;
    this._isPlaying = false;
    this._isPaused = false;
    
    this.clock = new THREE.Clock();
    this.animationId = null;
  }
  
  // 安全的直接渲染方法
  safeDirectRender() {
    try {
      // 1. 强制更新相机矩阵并验证
      this.camera.updateMatrixWorld(true);
      this.camera.updateProjectionMatrix();
      
      // 2. 检查相机矩阵有效性[2](@ref)
      if (Math.abs(this.camera.matrixWorld.determinant()) < 1e-10) {
        console.warn('相机世界矩阵不可逆，已重置。');
        this.camera.matrixWorld.identity();
        this.camera.updateProjectionMatrix();
      }

      // 3. 检查场景中主要对象的矩阵
      this.validateSceneMatrices();
      
      // 4. 清空渲染器并渲染
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      
    } catch (error) {
      console.warn('主场景渲染失败，尝试简化渲染:', error);
      this.fallbackRender();
    }
  }

  // 验证场景中主要对象的矩阵
  validateSceneMatrices() {
    // 检查主要组件的矩阵[2](@ref)
    const objectsToCheck = [this.linesGroup, this.barGroup, this.TriangleGroup];
    
    objectsToCheck.forEach(obj => {
      if (obj && obj.matrix && Math.abs(obj.matrix.determinant()) < 1e-10) {
        console.warn('检测到奇异矩阵，已重置:', obj);
        obj.matrix.identity();
        obj.updateMatrixWorld(true);
      }
    });
  }

  // 降级渲染方案
  fallbackRender() {
    try {
      this.renderer.clear();
      
      // 策略1: 尝试渲染一个安全的备用场景
      const backupScene = new THREE.Scene();
      const backupCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      backupCamera.position.z = 5;
      
      // 添加一个绝对不会出错的简单立方体
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const cube = new THREE.Mesh(geometry, material);
      backupScene.add(cube);
      
      this.renderer.render(backupScene, backupCamera);
      console.log('降级场景渲染成功。');
      
    } catch (innerError) {
      console.error('所有渲染尝试均失败:', innerError);
      // 最后的手段：至少清空画布
      this.renderer.clearColor();
      this.renderer.clear();
    }
  }
  
  // 初始化场景
  init(canvas) {
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true, 
      alpha: true,
      powerPreference: "high-performance" // 性能优化[9](@ref)
    });
    this.renderer.setClearAlpha(0);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    this.scene = new THREE.Scene();
    
    // 使用更合理的相机参数[4](@ref)
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.5,  // 增大近裁剪面，避免数值精度问题
      500   // 调整远裁剪面
    );
    this.camera.position.z = this.options.positionZ;
    
    // 确保相机矩阵有效[2](@ref)
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    
    // 初始化音频监听者
    const listener = new THREE.AudioListener();
    this.camera.add(listener);
    
    this.audioLines(20, this.options.N);
    this.audioBars(25, this.options.N / 2);
    
    this.TriangleGroup = new THREE.Group();
    setInterval(() => this.addTriangle(), 500);
    this.scene.add(this.TriangleGroup);
    
    this.initLight();
    this.initControls();
    this.initGui();
    this.initBloomPass();
    
    this.animate();
  }
  
  // 渲染几何体
  renderGeometries(vertices) {
    const res = [];
    vertices = vertices.concat(vertices[0]);
    vertices.forEach(value => {
      res.push(value.x, value.y, 0);
    });
    return new THREE.BufferAttribute(new Float32Array(res), 3);
  }
  
  // 更新圆形 - 修复缩放安全问题[1,3](@ref)
  updateCircle() {
    if (this.barNodes) {
      // 确保缩放值安全[4](@ref)
      const safeScale = Math.max(0.001, Math.min(this.scale, 10));
      this.linesGroup.scale.set(safeScale, safeScale, safeScale);
      
      const geometryA = this.outLine.geometry;
      const AttributeA = geometryA.getAttribute("position");
      const geometryB = this.inLine.geometry;
      const AttributeB = geometryB.getAttribute("position");

      const positions = this.barNodes.map(value => {
        return [value.positionA(), value.positionB()];
      });

      positions.forEach((position, index) => {
        AttributeA.setXYZ(index, position[0].x, position[0].y, 0);
        AttributeB.setXYZ(index, position[1].x, position[1].y, 0);
        
        const geometry = this.barLine[index].geometry;
        const Attribute = geometry.getAttribute("position");
        Attribute.setXYZ(0, position[0].x, position[0].y, 0);
        Attribute.setXYZ(1, position[1].x, position[1].y, 0);
        Attribute.needsUpdate = true;
      });
      
      // 修复数组长度一致性
      const nodeCount = this.barNodes.length;
      if (nodeCount > 0) {
        AttributeA.setXYZ(nodeCount, positions[0][0].x, positions[0][0].y, 0);
        AttributeB.setXYZ(nodeCount, positions[0][1].x, positions[0][1].y, 0);
      }
      
      AttributeA.needsUpdate = true;
      AttributeB.needsUpdate = true;
    }
  }
  
  // 音频线
  audioLines(radius, countData) {
    this.barNodes = range(0, countData).map(index => {
      return new node(
        radius,
        ((index / countData) * 360 + 45) % 360,
        new THREE.Vector2(0, 0)
      );
    });
    
    const lineMaterial = new THREE.LineBasicMaterial({
      color: this.gui.lineColor
    });
    
    this.barLine = range(0, countData).map(index => {
      return new THREE.Line(
        new THREE.BufferGeometry().setAttribute(
          "position",
          this.renderGeometries([
            this.barNodes[index].positionA(),
            this.barNodes[index].positionB()
          ])
        ),
        lineMaterial
      );
    });
    
    this.outLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        this.renderGeometries(this.barNodes.map(node => node.positionA()))
      ),
      lineMaterial
    );

    this.inLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        this.renderGeometries(this.barNodes.map(node => node.positionB()))
      ),
      lineMaterial
    );

    this.linesGroup = new THREE.Group();
    this.linesGroup.add(this.outLine);
    this.linesGroup.add(this.inLine);
    this.barLine.forEach(line => this.linesGroup.add(line));
    this.scene.add(this.linesGroup);
  }
  
  // 添加三角形
  addTriangle() {
    const material = new THREE.MeshBasicMaterial({
      color: this.gui.TrianglesBgColor
    });
    
    const lineMaterial = new THREE.LineBasicMaterial({
      color: this.gui.TrianglesLineColor
    });
    
    const triangle = this.makeTriangle(material, lineMaterial, t => {
      this.Triangles = this.Triangles.filter(triangle => triangle !== t);
      this.TriangleGroup.remove(t.group);
    });
    
    this.TriangleGroup.add(triangle.group);
    this.Triangles.push(triangle);
  }
  
  // 创建三角形
  makeTriangle(material, lineMaterial, t) {
    const triangle = new Triangle(
      2,
      new THREE.Vector3(0, 0, 0),
      Math.random() * 360,
      randomRange(5, 1),
      randomRange(0.1, 0.05),
      material,
      lineMaterial,
      {
        startShow: 15,
        endShow: 30,
        startHide: 60,
        endHide: 70
      },
      t
    );
    
    return triangle;
  }
  
  // 音频柱子 - 修复缩放安全问题[1](@ref)
  audioBars(radius, countData) {
    this.barGroup = new THREE.Group();
    let R = radius;
    let N = countData;
    
    for (let i = 0; i < N; i++) {
      let minGroup = new THREE.Group();
      let box = new THREE.BoxGeometry(1, 1, 1);
      let material = new THREE.MeshPhongMaterial({
        color: 0x00ffff
      });
      
      let m = i;
      let mesh = new THREE.Mesh(box, material);
      mesh.position.y = 0.5;
      minGroup.add(mesh);
      minGroup.position.set(
        Math.sin(((m * Math.PI) / N) * 2) * R,
        Math.cos(((m * Math.PI) / N) * 2) * R,
        0
      );
      minGroup.rotation.z = ((-m * Math.PI) / N) * 2;
      
      // 设置初始缩放避免为0[4](@ref)
      minGroup.scale.set(1, 0.001, 1);
      this.barGroup.add(minGroup);
    }
    
    this.scene.add(this.barGroup);
  }
  
  // 暂时禁用辉光效果以避免矩阵求逆问题
  initBloomPass() {
    this.composer = null;
  }
  
  // 动态渲染 - 修复缩放和矩阵更新逻辑[1,3](@ref)
  animate() {
    // 检查相机矩阵有效性[2](@ref)
    if (Math.abs(this.camera.matrixWorld.determinant()) < 1e-10) {
      this.camera.matrixWorld.identity();
      this.camera.updateProjectionMatrix();
    }

    this.controls.update();

    if (this.analyserNode) {
      // 获取频谱数据
      const arr = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.analyserNode.getByteFrequencyData(arr);
      
      if (this.barGroup) {
        this.barGroup.rotation.z += 0.002;
        
        // 确保缩放值安全[4](@ref)
        const safeScale = Math.max(0.001, Math.min(this.scale, 10));
        this.barGroup.scale.set(safeScale, safeScale, safeScale);
        
        this.barGroup.children.forEach((elem, index) => {
          if (this.gui.R) {
            elem.children[0].material.color.r = arr[index] / (this.gui.R * 3);
          }
          if (this.gui.G) {
            elem.children[0].material.color.g = arr[index] / (this.gui.G * 3);
          }
          if (this.gui.B) {
            elem.children[0].material.color.b = arr[index] / (this.gui.B * 3);
          }
          
          let m;
          if (arr[index] === 0) {
            // 不再设置为0，而是设置为一个很小的值[1](@ref)
            m = 0.001;
          } else {
            m = arr[index] / 20;
            let targetRange = Math.max(
              arr[index] / 20 - (arr[index - 1] || 0) / 20,
              0
            );
            if (m < targetRange) {
              m = targetRange;
            }
          }
          
          // 确保缩放值安全[4](@ref)
          elem.scale.set(1, Math.max(m, 0.001), 1);
        });
      }
      
      const Delta = this.clock.getDelta();
      this.barNodes.forEach((node, index, array) => {
        node.strength(arr[index % array.length] * 0.1);
        node.transition(Delta);
      });
      
      // 确保缩放值安全[1](@ref)
      const rawScale = 1 + arr[Math.ceil(arr.length * 0.05)] / 500;
      this.scale = Math.max(0.001, Math.min(rawScale, 5));
      
      this.updateCircle();
      this.Triangles.forEach(triangle => triangle.transition(Delta));
    }

    // 安全渲染逻辑
    if (this.composer) {
      try {
        this.composer.render();
      } catch (error) {
        console.warn('Composer渲染错误:', error);
        this.safeDirectRender();
      }
    } else {
      this.safeDirectRender();
    }
    this.animationId = requestAnimationFrame(this.animate.bind(this));
  }
  
  // 自适应屏幕
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }
  
  // 鼠标控制
  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enableZoom = true;
    this.controls.autoRotate = this.gui.rotate;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 200;
    this.controls.enablePan = false;
  }
  
  // GUI控制显示
  initGui() {
    // 创建GUI实例并隐藏关闭按钮
    let datGui = new GUI({
      closed: true,
      closeOnTop: false
    });
    // 隐藏关闭按钮
    if (datGui.__closeButton) {
      datGui.__closeButton.style.display = 'none';
    }
    // 移除标题行的点击关闭功能
    if (datGui.__ul && datGui.__ul.parentNode) {
      datGui.__ul.parentNode.style.pointerEvents = 'none';
    }
    
    datGui.add(this.gui, "R", 0, 255);
    datGui.add(this.gui, "G", 0, 255);
    datGui.add(this.gui, "B", 0, 255);
    datGui.add(this.gui, "rotate").onChange(val => {
      this.controls.autoRotate = val;
    });
  }
  
  // 环境光和平行光
  initLight() {
    this.scene.add(new THREE.AmbientLight(0x444444));
    let light = new THREE.PointLight(0xffffff);
    light.position.set(80, 100, 50);
    light.castShadow = true;
    this.scene.add(light);
  }
  
  // 音频加载 - 重构后
  audioLoad(url, onLoadCallback = null) {
    this._playStartTime = null;
    this._pauseDuration = 0;
    this._isPlaying = false;
    this._isPaused = false;
    
    // 初始化Web Audio API
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    let audioLoader = new THREE.AudioLoader();
    audioLoader.load(url, (AudioBuffer) => {
      this.audioBuffer = AudioBuffer;
      
      // 创建分析器
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.options.N * 2;
      
      // 创建音频源
      this.audioSource = this.audioContext.createBufferSource();
      this.audioSource.buffer = this.audioBuffer;
      this.audioSource.connect(this.analyserNode);
      this.analyserNode.connect(this.audioContext.destination);

      // 设置初始音量
      this.setVolume(this.options.volume);
      
      if (typeof onLoadCallback === 'function') {
        onLoadCallback();
      }
    }, undefined, (error) => {
      console.error('音频加载错误:', error);
    });
  }

  getCurrentTime() {
    
    
    if (!this.audioContext) return 0;
    if (this._isPaused) {
      console.log('获取当前播放时间', this._pauseDuration)
      return this._pauseDuration; // 暂停时返回已播放时间
    } else if (this._isPlaying) {
      // 当前播放时间 = (当前时间 - 播放开始时间) + 已累计暂停时间
      return (this.audioContext.currentTime - this._playStartTime) + this._pauseDuration;
    } else {
      return 0; // 未播放状态
    }
  }
  
  // 从指定时间开始播放
  playFromTime(startTime) {
    if (!this.audioBuffer || !this.audioContext) {
      console.error('音频未加载，请先调用audioLoad');
      return;
    }
    
    // 确保音频源未被使用
    if (this.audioSource) {
      this.audioSource.stop();
    }
    
    // 创建新音频源
    this.audioSource = this.audioContext.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    this.audioSource.connect(this.analyserNode);
    this.analyserNode.connect(this.audioContext.destination);
    
    // 从指定时间开始播放
    this.audioSource.start(0, startTime);
    
    // 更新状态
    this._isPlaying = true;
    this._isPaused = false;
    this._playStartTime = this.audioContext.currentTime;
    this._pauseDuration = startTime || 0;

    this.setVolume(this.options.volume);
  }
  
  // 播放音频
  playAudio() {
    if (!this.audioBuffer || !this.audioContext) return;
    
    if (this._isPaused) {
      // 从暂停位置继续
      // this.audioSource.start(0, this._playStartTime + this._pauseDuration);
      this._isPaused = false;
      this.playFromTime(this._pauseDuration); // 从指定时间开始播放
    } else if (!this._isPlaying) {
      // 从头开始播放
      this.audioSource.start(0, 0);
      this._isPlaying = true;
      this._playStartTime = this.audioContext.currentTime;
      this._pauseDuration = 0;
    }
  }
  
  // 暂停音频
  pauseAudio() {
    if (!this.audioSource || !this.audioContext) return;
    
    this.audioSource.stop();
    this._isPlaying = false;
    this._isPaused = true;
    
    // 记录暂停时已播放时间
    this._pauseDuration += this.audioContext.currentTime - this._playStartTime;
  }
  
  // 停止音频
  stopAudio() {
    if (this.audioSource) {
      this.audioSource.stop();
      this._isPlaying = false;
      this._isPaused = false;
      this._playStartTime = null;
      this._pauseDuration = 0;
    }
  }
  
  // 获取音频总时长
  getDuration() {
    if (this.audioBuffer) {
      return this.audioBuffer.duration;
    }
    return 0;
  }
  
  // 设置音频进度（从指定时间开始）
  seekTo(time) {
    if (time < 0) time = 0;
    
    if (!this.audioBuffer || !this.audioContext) return;
    
    // 停止当前播放
    if (this._isPlaying) {
      this.pauseAudio();
    }
    
    // 重置播放状态
    this._playStartTime = this.audioContext.currentTime;
    this._pauseDuration = time;
    
    // 从指定时间开始播放
    this.playFromTime(time);
  }
  
  // 设置音频音量
  setVolume(volume) {
    if (this.analyserNode && this.audioContext) {
      this.options.volume = volume;
      // Web Audio API的音量控制
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = volume;
      this.analyserNode.disconnect();
      this.analyserNode.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
    }
  }
  
  // 清理资源
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    if (this.renderer && this.renderer.domElement) {
      document.body.removeChild(this.renderer.domElement);
    }
    
    window.removeEventListener("resize", this.onWindowResize.bind(this));
    
    if (this.Triangles) {
      this.Triangles.forEach(triangle => triangle.delete());
    }
    
    // 清理音频资源
    if (this.audioSource) {
      this.audioSource.stop();
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}