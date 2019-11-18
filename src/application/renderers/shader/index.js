import createContext from "pex-context";
import { frames } from "../../worker/frame-counter";
import store from "../../worker/store";
import defaultShader from "./default-shader";

const shaderCanvas = new OffscreenCanvas(300, 300);
const shaderContext = shaderCanvas.getContext("webgl2", {
  antialias: true,
  desynchronized: true,
  powerPreference: "high-performance",
  premultipliedAlpha: false
});

store.dispatch("outputs/addAuxillaryOutput", {
  name: "shader-buffer",
  context: shaderContext,
  group: "buffer"
});

const pex = createContext({ gl: shaderContext });

const a_position = pex.vertexBuffer([-1, -1, -1, 1, 1, 1, 1, 1, 1, -1, -1, -1]);
const indices = pex.indexBuffer([0, 1, 2, 3, 4, 5]);

const commands = {};

let canvasTexture;

const clearCmd = {
  pass: pex.pass({
    clearColor: [0, 0, 0, 1],
    clearDepth: 1
  })
};

function generateUniforms(canvasTexture, uniforms) {
  const { width, height, dpr } = store.state.size;

  const date = new Date();
  const time = performance.now();
  const resolution = [width, height, dpr];

  const defaults = {
    iGlobalTime: time / 1000,
    iFrame: frames(),
    iDate: [date.getFullYear(), date.getMonth(), date.getDay(), time / 1000],
    iTime: time / 1000,
    iTimeDelta: time / 1000,
    iResolution: resolution,
    iChannel0: canvasTexture,
    iChannel1: canvasTexture,
    iChannel2: canvasTexture,
    iChannel3: canvasTexture,
    iChannelResolution: [resolution, resolution, resolution, resolution],
    u_modVCanvas: canvasTexture,
    u_delta: time / 1000,
    u_time: time
  };

  return { ...uniforms, ...defaults };
}

function makeProgram(Module) {
  return new Promise(resolve => {
    let vert = Module.vertexShader;
    let frag = Module.fragmentShader;

    if (!vert) {
      vert = defaultShader.v;
    }

    if (!frag) {
      frag = defaultShader.f;
    }

    if (frag.search("gl_FragColor") < 0) {
      frag = defaultShader.fWrap.replace(/(%MAIN_IMAGE_INJECT%)/, frag);

      vert = defaultShader.v300;
    }

    const pipeline = pex.pipeline({
      depthTest: true,
      vert,
      frag
    });

    const shaderUniforms = {};

    if (Module.props) {
      const modulePropsKeys = Object.keys(Module.props);
      const modulePropsKeysLength = modulePropsKeys.length;

      for (let i = 0; i < modulePropsKeysLength; i++) {
        const key = modulePropsKeys[i];

        if (Module.props[key].type === "texture") {
          shaderUniforms[key] = Module.props[key].texture;
        } else {
          shaderUniforms[key] = Module.props[key];
        }
      }
    }

    const uniforms = generateUniforms(canvasTexture, shaderUniforms);

    const command = {
      pipeline,
      attributes: {
        a_position,
        position: a_position
      },
      indices,
      uniforms
    };

    commands[Module.meta.name] = command;

    resolve(Module);
  });
}

async function setupModule(Module) {
  try {
    return await makeProgram(Module);
  } catch (e) {
    throw new Error(e);
  }
}

function render({ module, props, canvas, context }) {
  if (!canvasTexture) {
    canvasTexture = pex.texture2D({
      data: canvas.data || canvas,
      width: canvas.width,
      height: canvas.height,
      pixelFormat: pex.PixelFormat.RGBA8,
      encoding: pex.Encoding.Linear,
      min: pex.Filter.Linear,
      mag: pex.Filter.Linear,
      wrap: pex.Wrap.Repeat
    });
  } else {
    pex.update(canvasTexture, {
      width: canvas.width,
      height: canvas.height,
      data: canvas.data || canvas
    });
  }

  const shaderUniforms = {};

  if (props) {
    const modulePropsKeys = Object.keys(props);
    const modulePropsKeysLength = modulePropsKeys.length;

    for (let i = 0; i < modulePropsKeysLength; i++) {
      const key = modulePropsKeys[i];

      if (module.props[key].type === "texture") {
        shaderUniforms[key] = props[key].texture;
      } else {
        shaderUniforms[key] = props[key];
      }
    }
  }

  const uniforms = generateUniforms(canvasTexture, shaderUniforms);

  const command = commands[module.meta.name];

  pex.submit(clearCmd);
  pex.submit(command, {
    uniforms
  });

  // Copy Shader Canvas to Main Canvas
  context.drawImage(shaderCanvas, 0, 0, canvas.width, canvas.height);
}

export { setupModule, render };
