import { ChangeDetectorRef, ComponentFactory, ComponentRef, DoCheck, OnChanges, OnInit, SimpleChange, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';

const PRIVATE_PREFIX = '__ngxOnChanges_';

type OnChangesExpando = OnChanges & {
    __ngOnChanges_: SimpleChanges | null | undefined;
    [ key: string ]: any;
};

export type LifeCycleComponent = OnInit & DoCheck;

interface ComponentProperty {
    propName: string;
    templateName: string;
}

function onChangesWrapper(delegateHook: (() => void) | null) {
    return function(this: OnChangesExpando) {
        const simpleChanges = this[ PRIVATE_PREFIX ];

        if (simpleChanges != null) {
            if (this.ngOnChanges) {
                this.ngOnChanges(simpleChanges);
            }
            this[ PRIVATE_PREFIX ] = null;
        }

        if (delegateHook) {
            delegateHook.apply(this);
        }
    };
}

function markForCheckWrapper(delegateHook: (() => void) | null, cd) {
    return function(this) {
        if (delegateHook) {
            delegateHook.apply(this);
        }

        if (cd) {
            cd.markForCheck();
        }
    };
}

export interface NgxComponentOutletAdapterRefConfig<TComponent> {
    componentFactory: ComponentFactory<TComponent>;
    componentRef: ComponentRef<TComponent>;
    context: TComponent;
    onInitComponentRef?: ComponentRef<LifeCycleComponent>;
    doCheckComponentRef?: ComponentRef<LifeCycleComponent>;
}

export class NgxComponentOutletAdapterRef<TComponent> {

    public componentFactory: ComponentFactory<TComponent>;
    public componentRef: ComponentRef<TComponent>;
    public context: TComponent;
    private onInitComponentRef: ComponentRef<LifeCycleComponent>;
    private doCheckComponentRef: ComponentRef<LifeCycleComponent>;
    private attachedOutputs: Subscription[] = [];
    private defaultDescriptors: { [ key: string ]: PropertyDescriptor } = {};

    constructor(config: NgxComponentOutletAdapterRefConfig) {
        this.componentFactory = config.componentFactory;
        this.componentRef = config.componentRef;
        this.context = config.context;
        this.onInitComponentRef = config.onInitComponentRef;
        this.doCheckComponentRef = config.doCheckComponentRef;

        this.attachInputs();
        this.attachOutputs();
    }

    dispose(): void {
        this.disposeOutputs();
        this.disposeInputs();

        if (this.componentRef) {
            this.componentRef.destroy();
        }

        if (this.onInitComponentRef) {
            this.onInitComponentRef.destroy();
        }

        if (this.doCheckComponentRef) {
            this.doCheckComponentRef.destroy();
        }
    }

    private attachInputs(): void {
        const componentRef: ComponentRef<TComponent & LifeCycleComponent> = this.componentRef as any;
        const onInitComponentRef: ComponentRef<LifeCycleComponent> = this.onInitComponentRef || componentRef as any;
        const doCheckComponentRef: ComponentRef<LifeCycleComponent> = this.doCheckComponentRef || componentRef as any;

        const changeDetectorRef: ChangeDetectorRef = this.componentRef.injector.get(ChangeDetectorRef, this.componentRef.changeDetectorRef);

        const inputs: ComponentProperty[] = this.componentFactory.inputs;

        inputs.forEach(({ propName, templateName }: ComponentProperty) => {
            const defaultDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(this.context, templateName);

            this.defaultDescriptors[ templateName ] = defaultDescriptor;

            Object.defineProperty(this.context, templateName, {
                get: () => componentRef.instance[ propName ],
                set: (value: any) => {
                    let simpleChanges = componentRef.instance[ PRIVATE_PREFIX ];
                    const isFirstChange = simpleChanges === undefined;

                    if (simpleChanges == null) {
                        simpleChanges = componentRef.instance[ PRIVATE_PREFIX ] = {};
                    }

                    simpleChanges[ templateName ] = new SimpleChange(componentRef.instance[ propName ], value, isFirstChange);
                    componentRef.instance[ propName ] = value;

                    if (defaultDescriptor && defaultDescriptor.set) {
                        defaultDescriptor.set.call(this.context, value);
                    }
                }
            });
        });

        if (this.componentFactory.componentType.prototype.hasOwnProperty('ngOnChanges')) {
            onInitComponentRef.instance.ngOnInit = onChangesWrapper(componentRef.instance.ngOnInit).bind(componentRef.instance);

            doCheckComponentRef.instance.ngDoCheck = onChangesWrapper(
                markForCheckWrapper(componentRef.instance.ngDoCheck, changeDetectorRef)
            ).bind(componentRef.instance);
        } else {
            doCheckComponentRef.instance.ngDoCheck = markForCheckWrapper(componentRef.instance.ngDoCheck, changeDetectorRef);
        }
    }

    private attachOutputs(): void {
        const outputs: ComponentProperty[] = this.componentFactory.outputs.filter(
            (property: ComponentProperty) => this.context.hasOwnProperty(property.templateName));

        this.attachedOutputs = outputs.map((property: ComponentProperty) =>
                this.componentRef.instance[ property.propName ].subscribe(this.context[ property.templateName ]));
    }

    private disposeOutputs(): void {
        if (this.attachedOutputs) {
            this.attachedOutputs.splice(0).forEach((subscription) => subscription.unsubscribe());
        }
    }

    private disposeInputs(): void {
        if (this.defaultDescriptors) {
            Object.keys(this.defaultDescriptors).map((propName) => {
                const defaultDescriptor: PropertyDescriptor = this.defaultDescriptors[ propName ];

                defaultDescriptor ? Object.defineProperty(this.context, propName, defaultDescriptor) : delete this.context[ propName ];
            });
        }
    }

}